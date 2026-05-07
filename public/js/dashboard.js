/* ============================================
   THE BRIDGE — Dashboard Interactions
   Commander chat, run history, chart management
   ============================================ */

class Dashboard {
  constructor() {
    this.messagesEl = document.querySelector('.commander-messages');
    this.inputEl = document.querySelector('.commander-input');
    this.sendBtn = document.querySelector('.commander-send');
    this.sessionCount = 0;
    this.maxSessions = 20;

    this.init();
  }

  init() {
    if (this.sendBtn) {
      this.sendBtn.addEventListener('click', () => this.sendMessage());
    }
    if (this.inputEl) {
      this.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    // Run history expansion
    document.querySelectorAll('.run-entry').forEach(entry => {
      entry.addEventListener('click', () => {
        entry.classList.toggle('expanded');
      });
    });

    this.loadSessionCount();
  }

  async loadSessionCount() {
    try {
      const res = await fetch('/api/member/commander/sessions');
      if (res.ok) {
        const data = await res.json();
        this.sessionCount = data.used || 0;
        this.maxSessions = data.max || 20;
        this.updateSessionDisplay();
      }
    } catch (e) {
      console.debug('Failed to load session count');
    }
  }

  updateSessionDisplay() {
    const el = document.querySelector('.commander-sessions');
    if (el) {
      const remaining = this.maxSessions - this.sessionCount;
      el.textContent = `${remaining} of ${this.maxSessions} sessions remaining this month`;
    }
  }

  async sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text) return;

    // Add user message to chat
    this.appendMessage(text, 'from-user');
    this.inputEl.value = '';
    this.inputEl.disabled = true;
    this.sendBtn.disabled = true;

    try {
      const res = await fetch('/api/member/commander/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });

      if (!res.ok) {
        throw new Error('Commander unavailable');
      }

      const data = await res.json();
      this.appendMessage(data.response, 'from-commander');
      this.sessionCount++;
      this.updateSessionDisplay();
    } catch (e) {
      this.appendMessage('The Commander is temporarily unavailable. Try again shortly.', 'from-commander');
    } finally {
      this.inputEl.disabled = false;
      this.sendBtn.disabled = false;
      this.inputEl.focus();
    }
  }

  appendMessage(text, className) {
    const msg = document.createElement('div');
    msg.className = `commander-message ${className}`;
    msg.textContent = text;
    this.messagesEl.appendChild(msg);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.dashboard-page')) {
    new Dashboard();
  }
});
