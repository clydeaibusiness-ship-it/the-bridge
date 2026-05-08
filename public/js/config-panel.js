import { CONFIG } from '/config.js';

// Build UI from CONFIG object
const sections = document.getElementById('cp-sections');

function buildSection(title, obj, path = '') {
  const section = document.createElement('div');
  section.className = 'cp-section';
  section.innerHTML = `<h2 class="cp-section-title">${title}</h2>`;

  Object.entries(obj).forEach(([key, val]) => {
    const fullPath = path ? `${path}.${key}` : key;

    if (typeof val === 'object' && val !== null &&
        !Array.isArray(val)) {
      section.appendChild(buildSection(key, val, fullPath));
    } else {
      section.appendChild(buildControl(key, val, fullPath));
    }
  });

  return section;
}

function buildControl(key, val, path) {
  const row = document.createElement('div');
  row.className = 'cp-row';

  const label = document.createElement('label');
  label.className  = 'cp-label';
  label.textContent = key;
  label.title      = path;

  let input;

  if (typeof val === 'boolean') {
    input = document.createElement('input');
    input.type    = 'checkbox';
    input.checked = val;
    input.className = 'cp-toggle';
    input.onchange = () => {
      setNestedValue(CONFIG, path, input.checked);
      showChanged(row, path, input.checked);
    };
  } else if (typeof val === 'number') {
    input = document.createElement('input');
    input.type      = 'number';
    input.value     = val;
    input.step      = val < 1 ? 0.01 : val < 10 ? 0.1 : 1;
    input.className = 'cp-number';
    input.oninput = () => {
      const num = parseFloat(input.value);
      setNestedValue(CONFIG, path, num);
      showChanged(row, path, num);
    };
  } else if (typeof val === 'string' &&
             val.startsWith('#')) {
    input = document.createElement('input');
    input.type      = 'color';
    input.value     = val;
    input.className = 'cp-color';
    input.oninput = () => {
      setNestedValue(CONFIG, path, input.value);
      showChanged(row, path, input.value);
    };
  } else if (typeof val === 'string') {
    input = document.createElement('textarea');
    input.value     = val;
    input.rows      = 2;
    input.className = 'cp-text';
    input.oninput = () => {
      setNestedValue(CONFIG, path, input.value);
      showChanged(row, path, input.value);
    };
  } else if (Array.isArray(val)) {
    input = document.createElement('input');
    input.type      = 'text';
    input.value     = JSON.stringify(val);
    input.className = 'cp-number';
    input.oninput = () => {
      try {
        const arr = JSON.parse(input.value);
        setNestedValue(CONFIG, path, arr);
        showChanged(row, path, arr);
        input.style.borderColor = '';
      } catch {
        input.style.borderColor = 'var(--damage)';
      }
    };
  } else {
    input = document.createElement('span');
    input.textContent = JSON.stringify(val);
    input.className = 'cp-label';
  }

  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function showChanged(row, path, newVal) {
  row.classList.add('changed');
  let hint = row.querySelector('.cp-hint');
  if (!hint) {
    hint = document.createElement('span');
    hint.className = 'cp-hint';
    row.appendChild(hint);
  }
  hint.textContent = `→ Copy to config.js: ${path} = ${JSON.stringify(newVal)}`;
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur[keys[i]];
    if (!cur) return;
  }
  cur[keys[keys.length - 1]] = value;
}

// Build all sections
Object.entries(CONFIG).forEach(([sectionKey, sectionVal]) => {
  if (typeof sectionVal === 'object') {
    sections.appendChild(buildSection(sectionKey, sectionVal, sectionKey));
  }
});
