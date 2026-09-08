import React from 'react';
import { sectionStyles as styles } from './sectionStyles';

interface Props {
  skills: string[];
  onChange: (skills: string[]) => void;
}

export function SkillsEditor({ skills, onChange }: Props): React.JSX.Element {
  const update = (index: number, value: string) => {
    onChange(skills.map((skill, current) => current === index ? value : skill));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= skills.length) return;
    const next = [...skills];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <section>
      <h2 style={{ ...styles.sectionTitle, marginTop: '36px' }}>专业技能</h2>
      {skills.map((skill, index) => (
        <div
          key={index}
          data-skill-index={index}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}
        >
          <input
            value={skill}
            onChange={event => update(index, event.target.value)}
            style={{ ...styles.input, flex: 1 }}
            placeholder="请输入专业技能"
            aria-label={`专业技能 ${index + 1}`}
          />
          <button
            type="button"
            onClick={() => move(index, -1)}
            disabled={index === 0}
            style={styles.iconButton}
          >
            上移
          </button>
          <button
            type="button"
            onClick={() => move(index, 1)}
            disabled={index === skills.length - 1}
            style={styles.iconButton}
          >
            下移
          </button>
          <button
            type="button"
            onClick={() => onChange(skills.filter((_, current) => current !== index))}
            style={styles.removeButton}
          >
            删除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...skills, ''])}
        style={styles.addButton}
      >
        添加专业技能
      </button>
    </section>
  );
}
