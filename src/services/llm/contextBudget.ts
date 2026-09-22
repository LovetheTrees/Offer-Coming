/**
 * 上下文预算与切分工具。
 *
 * 背景：网申补填 / 视觉补填 / 简历解析会把「完整简历资料」或「整份简历原文」
 * 塞进一次 LLM 请求。资料一旦经历、项目描述较长或记录很多，输入极易超过模型
 * 的上下文窗口，API 返回 context_length_exceeded / context window too long
 * 之类的错误，用户看到的就是「上下文窗口不够」。
 *
 * 本模块从源头控制输入体积：
 * - estimateTokens：粗略估算 token 数（中文按 ~1 token/字，英文按 ~1 token/4 字符）。
 * - truncateForBudget：按预算截断超长文本，保留开头与结尾，中间用省略号代替。
 * - compactProfileForSection：只取「当前补填模块」相关的资料子集，并对每个
 *   长文本字段做预算截断，序列化时不缩进、去掉冗余字段，最大限度压缩输入。
 */

import type { UserProfile } from '../../shared/types';

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;
const SPACE_RE = /\s+/g;

/** 粗略估算一段文本的 token 数。CJK 字符按 ~1 token/字，其余按 ~4 字符/token。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 4);
}

/** 把字符串按预算（token）截断：保留头部与尾部各一段，中间省略。 */
export function truncateForBudget(
  text: string,
  maxTokens: number,
  tailTokens = Math.floor(maxTokens / 4),
): string {
  if (!text) return '';
  if (estimateTokens(text) <= maxTokens) return text;

  const trimmed = text.replace(SPACE_RE, ' ').trim();
  const tailChars = Math.max(4, Math.floor(tailTokens * 3));
  const tail = trimmed.slice(-tailChars);
  const maxHeadTokens = Math.max(8, maxTokens - estimateTokens(tail) - 4);

  // 用 estimateTokens 精确逼近，避免中文(1字/token)与英文(4字符/token)换算偏差
  let head = trimmed.length;
  while (head > 0 && estimateTokens(`${trimmed.slice(0, head)}…${tail}`) > maxTokens) {
    head = Math.floor(head * 0.7);
    if (head <= maxHeadTokens) break;
  }

  // 防止死循环：head 已压到极小仍超预算时（单段极长文本），强制按字符强切
  if (head <= 0 || estimateTokens(`${trimmed.slice(0, head)}…${tail}`) > maxTokens) {
    head = Math.max(1, Math.floor(maxTokens / 2));
  }

  const omitted = trimmed.length - head - tail.length;
  if (omitted <= 0) {
    return trimmed.slice(0, Math.max(1, maxTokens)) + '…[已截断]';
  }
  return `${trimmed.slice(0, head)}…[已截断，省略 ${omitted} 字符]…${tail}`;
}

/** 单个长文本字段的默认预算（token）。 */
const FIELD_TEXT_BUDGET = 260;
/** 单个数组模块（教育/经历/项目/奖项）最多保留的最近记录数。 */
const MAX_RECORDS = 8;

/** 每个描述类字段独立截断到预算内，避免某条超长描述拖垮整段输入。 */
function capField(value: string | undefined, budget = FIELD_TEXT_BUDGET): string {
  if (!value) return '';
  return truncateForBudget(value, budget);
}

/** 把对象值裁剪成紧凑结构，去掉空字符串与空数组，减少冗余 token。 */
function compactify<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** 教育记录。 */
function mapEducation(records: UserProfile['education']): Record<string, unknown>[] {
  return records.slice(0, MAX_RECORDS).map(r => compactify({
    school: r.school, major: r.major, degree: r.degree,
    educationType: r.educationType, startDate: r.startDate, endDate: r.endDate,
    gpa: r.gpa, ranking: r.ranking, college: r.college,
  }));
}

/** 工作/实习经历：长描述是主要体积来源，单独做预算控制。 */
function mapExperience(records: UserProfile['experience']): Record<string, unknown>[] {
  return records.slice(0, MAX_RECORDS).map(r => compactify({
    company: r.company, position: r.position,
    startDate: r.startDate, endDate: r.endDate,
    description: capField(r.description),
  }));
}

/** 项目经历。 */
function mapProjects(records: UserProfile['projects']): Record<string, unknown>[] {
  return records.slice(0, MAX_RECORDS).map(r => compactify({
    name: r.name, role: r.role,
    startDate: r.startDate, endDate: r.endDate,
    description: capField(r.description),
  }));
}

/**
 * 按「当前补填模块」裁剪简历资料，返回紧凑对象（尚未序列化）。
 *
 * 只保留与 section 相关的子集 + 基本信息，并对长文本做预算截断，
 * 把一次请求的输入控制在一个稳定、远小于模型窗口的体积内。
 */
export function compactProfileForSection(
  profile: UserProfile,
  section: string,
): Record<string, unknown> {
  const key = (section || '').toLowerCase();

  const personal = compactify({
    name: profile.personal.name,
    gender: profile.personal.gender,
    birthDate: profile.personal.birthDate,
    phone: profile.personal.phone,
    email: profile.personal.email,
    wechat: profile.personal.wechat,
    idCard: profile.personal.idCard,
    politicalStatus: profile.personal.politicalStatus,
    ethnicity: profile.personal.ethnicity,
    hometown: profile.personal.hometown,
    currentAddress: profile.personal.currentAddress,
    selfEvaluation: capField(profile.personal.selfEvaluation, 320),
  });

  const wants = (terms: string[]) => terms.some(t => key.includes(t));

  const subset: Record<string, unknown> = { personal };

  if (wants(['education', '学历', '教育'])) {
    subset.education = mapEducation(profile.education);
  }
  if (wants(['experience', '工作', '实习', '经历'])) {
    subset.experience = mapExperience(profile.experience);
  }
  if (wants(['project', '项目'])) {
    subset.projects = mapProjects(profile.projects);
  }
  if (wants(['award', '奖项', '荣誉'])) {
    subset.awards = profile.awards.slice(0, MAX_RECORDS).map(a => compactify({
      name: a.name, role: a.role, date: a.date,
      description: capField(a.description),
    }));
  }
  if (wants(['skill', '技能'])) {
    subset.skills = profile.skills;
  }
  if (wants(['certif', '证书', '资格'])) {
    subset.certifications = profile.certifications.slice(0, MAX_RECORDS).map(c => compactify({
      name: c.name, issuer: c.issuer, date: c.date, credentialId: c.credentialId,
    }));
  }
  if (wants(['custom', '自定义', '其他'])) {
    subset.customInformation = profile.customInformation.slice(0, MAX_RECORDS).map(c => compactify({
      name: c.name, content: capField(c.content),
    }));
  }

  // 未命中任何模块（如补填基本信息）时，兜底附带技能与证书，它们常被多数表单用到
  if (Object.keys(subset).length <= 1) {
    subset.skills = profile.skills;
    subset.certifications = profile.certifications.slice(0, MAX_RECORDS).map(c => compactify({
      name: c.name, issuer: c.issuer, date: c.date, credentialId: c.credentialId,
    }));
  }

  return subset;
}

/** 把裁剪后的资料对象序列化成紧凑单行 JSON（不缩进，节省 token）。 */
export function serializeCompactProfile(subset: Record<string, unknown>): string {
  return JSON.stringify(subset);
}

/**
 * 对简历原文做预算控制：超长时返回截断文本与是否被截断。
 * 默认预算 12000 token：即使模型窗口只有 32k，输入 + 输出（默认 8192）也有富余。
 */
export function budgetResumeText(rawText: string, maxTokens = 12000): {
  text: string;
  truncated: boolean;
} {
  if (estimateTokens(rawText) <= maxTokens) {
    return { text: rawText, truncated: false };
  }
  return { text: truncateForBudget(rawText, maxTokens, Math.floor(maxTokens / 5)), truncated: true };
}
