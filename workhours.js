// 工时填报检查页面脚本（V3.1，统一 exe 架构）
// 流程：GET_COOKIES 取 ITA Cookie → 本地后端 /api/workhours/projects（有工时计划的项目，跨年合并）
//      → 选项目 → /api/workhours/target 成员统计 → 误差着色 → 复制邮箱/邮件文本 → 检查历史 + 数据收集
// 统计口径由后端保证（计划直加=目标；填报÷8=已填；完成率升序；无计划成员视为 100%）

const MAIL_DOMAIN = '@abchina.com.cn';

document.addEventListener('DOMContentLoaded', () => {
  const svcPill = document.getElementById('svcPill');
  const svcDot = document.getElementById('svcDot');
  const svcText = document.getElementById('svcText');
  const loadBtn = document.getElementById('loadBtn');
  const projSelect = document.getElementById('projSelect');
  const checkBtn = document.getElementById('checkBtn');
  const toleranceSel = document.getElementById('toleranceSel');
  const projMeta = document.getElementById('projMeta');
  const tableTip = document.getElementById('tableTip');
  const memberTable = document.getElementById('memberTable');
  const checkAllBox = document.getElementById('checkAll');
  const copyMailBtn = document.getElementById('copyMailBtn');
  const copyTextBtn = document.getElementById('copyTextBtn');
  const pickInfo = document.getElementById('pickInfo');
  const statusLine = document.getElementById('statusLine');

  let SERVICE = 'http://127.0.0.1:8765';
  try {
    chrome.storage.local.get(['fcBackendUrl'], (r) => {
      if (r.fcBackendUrl) SERVICE = r.fcBackendUrl;
      boot();
    });
  } catch (e) { boot(); }

  // ── 状态 ──
  let cookie = '';
  let projects = [];      // [{id, projname, projectno, target_amt, completed_amt, achievement_rate, last_date}]
  let members = [];       // [{id, name, target_amt, completed_amt, achievement_rate}]
  let currentProj = null; // projects 中选中项
  let year = null;
  let busy = false;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const setStatus = (msg, isError) => {
    statusLine.style.display = 'block';
    statusLine.textContent = msg;
    statusLine.className = 'status-line' + (isError ? ' error' : '');
  };

  // ── 后端探活与唤起 ──
  const triggerProtocol = () => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = 'projecttool://start';
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1000);
      return true;
    } catch (e) { return false; }
  };

  const tryStartBackend = () => new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage('com.projecttool.startbackend', { action: 'start' }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(triggerProtocol());
          return;
        }
        resolve(!!(resp && resp.ok) || triggerProtocol());
      });
    } catch (e) {
      resolve(triggerProtocol());
    }
  });

  let askedStart = false;
  async function checkHealth() {
    for (let i = 0; i < 5; i++) {
      try {
        const resp = await fetch(SERVICE + '/health');
        const data = await resp.json();
        if (data && data.ok) {
          svcText.textContent = '服务已连接';
          svcDot.className = 'dot online';
          svcPill.className = 'pg-pill';
          return true;
        }
      } catch (e) {
        if (i === 0 && !askedStart) {
          askedStart = true;
          const ok = window.confirm('本地后端未启动，是否启动后端程序？\n（首次使用请先运行「安装后端.bat」完成注册）');
          if (ok) {
            const started = await tryStartBackend();
            if (!started) setStatus('无法自动唤起后端，请运行「安装后端.bat」注册，或双击「项目管理工具后端.exe」启动。', true);
          }
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    svcText.textContent = '服务未启动';
    svcDot.className = 'dot offline';
    svcPill.className = 'pg-pill';
    return false;
  }

  function boot() {
    checkHealth();
    try {
      chrome.runtime.sendMessage({ type: 'GET_COOKIES' }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok) return;
        cookie = resp.cookie || '';
      });
    } catch (e) { /* 忽略 */ }
  }

  const post = async (path, body) => {
    const resp = await fetch(SERVICE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      throw new Error(data.error || ('HTTP ' + resp.status));
    }
    return data;
  };

  // ── ① 获取工时项目 ──
  loadBtn.addEventListener('click', async () => {
    if (!cookie) {
      try {
        chrome.runtime.sendMessage({ type: 'GET_COOKIES' }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) { setStatus('无法获取 ita.abc Cookie，请先登录 ita.abc。', true); return; }
          cookie = resp.cookie || '';
          if (cookie) loadBtn.click();
        });
      } catch (e) { setStatus('无法获取 ita.abc Cookie，请先登录 ita.abc。', true); }
      return;
    }
    if (busy) return;
    busy = true;
    loadBtn.disabled = true;
    setStatus('正在获取工时项目列表（今年 + 去年）…', false);
    try {
      const data = await post('/api/workhours/projects', { cookie });
      projects = data.projects || [];
      year = data.year;
      if (!projects.length) {
        setStatus('未获取到有工时计划的项目，请确认已在 ITA 中分配工时。', true);
        return;
      }
      projects.sort((a, b) => (a.achievement_rate || 0) - (b.achievement_rate || 0));
      projSelect.innerHTML = projects.map((p) =>
        `<option value="${esc(p.id)}">${esc(p.projname)}（${esc(p.projectno || '-')}）· 完成率 ${p.achievement_rate}%</option>`
      ).join('');
      projSelect.disabled = false;
      checkBtn.disabled = false;
      setStatus(`获取到 ${projects.length} 个有工时计划的项目（数据年份 ${year} 及上年），按完成率升序排列。`, false);
    } catch (e) {
      setStatus(e.message || '获取工时项目失败。', true);
    } finally {
      busy = false;
      loadBtn.disabled = false;
    }
  });

  // ── ② 检查所选项目成员 ──
  const rateCls = (rate, tol) => {
    if (rate < 100 - tol) return 'low';
    if (rate > 100 + tol) return 'over';
    return 'pass';
  };
  const rateText = (rate, tol) => {
    const cls = rateCls(rate, tol);
    if (cls === 'pass') return { cls, txt: '达标' };
    return { cls, txt: cls === 'low' ? '未填满' : '超填' };
  };

  const renderMembers = () => {
    const tol = Number(toleranceSel.value);
    if (!members.length) {
      memberTable.innerHTML = '<div class="list-empty">① 点击「获取工时项目」→ ② 选择项目 → ③ 开始检查</div>';
      return;
    }
    memberTable.innerHTML = members.map((m, i) => {
      const { cls, txt } = rateText(m.achievement_rate, tol);
      return `
        <div class="member-row" data-index="${i}">
          <span><input type="checkbox" class="m-cb" data-index="${i}" ${m.checked ? 'checked' : ''}></span>
          <span class="m-name">${esc(m.name || '-')}</span>
          <span class="m-mail">${esc(m.id)}${MAIL_DOMAIN}</span>
          <span class="m-num">${m.completed_amt}</span>
          <span class="m-num">${m.target_amt}</span>
          <span><span class="rate-tag ${cls}">${m.achievement_rate}%</span></span>
          <span><span class="st-tag ${cls}">${txt}</span></span>
        </div>`;
    }).join('');
    memberTable.querySelectorAll('.m-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        members[Number(cb.dataset.index)].checked = cb.checked;
        refreshPick();
      });
    });
    refreshPick();
  };

  const refreshPick = () => {
    const picked = members.filter((m) => m.checked);
    copyMailBtn.disabled = busy || !picked.length;
    copyTextBtn.disabled = busy || !picked.length;
    pickInfo.textContent = picked.length ? `已勾选 ${picked.length} 人` : '';
    checkAllBox.checked = members.length > 0 && members.every((m) => m.checked);
  };

  checkBtn.addEventListener('click', async () => {
    const prjid = projSelect.value;
    if (!prjid) { setStatus('请先选择项目。', true); return; }
    if (busy) return;
    busy = true;
    checkBtn.disabled = true;
    loadBtn.disabled = true;
    setStatus('正在统计项目成员工时填报（今年 + 去年合并）…', false);
    const t0 = Date.now();
    try {
      const data = await post('/api/workhours/target', { cookie, prjid });
      members = data.members || [];
      year = data.year || year;
      currentProj = projects.find((p) => p.id === prjid) || null;

      if (!members.length) {
        memberTable.innerHTML = '<div class="list-empty">该项目没有成员工时数据。</div>';
        setStatus('该项目没有成员工时数据。', true);
        return;
      }
      // 默认勾选未填满成员（与原工具口径一致）
      const tol = Number(toleranceSel.value);
      members.forEach((m) => { m.checked = m.achievement_rate < 100 - tol; });

      if (currentProj) {
        projMeta.style.display = 'flex';
        projMeta.innerHTML = `
          <span>项目：<b>${esc(currentProj.projname)}</b>（${esc(currentProj.projectno || '-')}）</span>
          <span>整体目标：<b>${currentProj.target_amt}</b> 人天</span>
          <span>整体已填：<b>${currentProj.completed_amt}</b> 人天</span>
          <span>整体完成率：<span class="rate">${currentProj.achievement_rate}%</span></span>
          ${currentProj.last_date ? `<span>计划截止：<b>${esc(currentProj.last_date)}</b></span>` : ''}
          <span>数据年份：<b>${year} / ${year - 1}</b></span>`;
      }

      renderMembers();
      tableTip.textContent = `误差线 ±${tol}%（可在上方切换）`;

      const fail = members.filter((m) => m.achievement_rate < 100 - tol).length;
      const over = members.filter((m) => m.achievement_rate > 100 + tol).length;
      const avg = members.length
        ? Math.round(members.reduce((s, m) => s + m.achievement_rate, 0) / members.length * 100) / 100
        : 0;
      setStatus(`检查完成：成员 ${members.length} 人，未填满 ${fail} 人、超填 ${over} 人（默认勾选未填满），平均完成率 ${avg}%。`, fail > 0);

      // ── 检查历史 + 数据收集 ──
      const record = {
        type: 'workhours',
        source: 'ita',
        project: currentProj
          ? { prjid: currentProj.id, projname: currentProj.projname, projectno: currentProj.projectno, projtype: '' }
          : { prjid, projname: '', projectno: '', projtype: '' },
        files: [],
        summary: { users: members.length, fail, over, avgRate: avg },
        detail: {
          members: members.map((m) => ({ id: m.id, name: m.name, target_amt: m.target_amt, completed_amt: m.completed_amt, achievement_rate: m.achievement_rate })),
          tolerance: tol,
          year,
        },
        durationSec: Math.round((Date.now() - t0) / 100) / 10,
      };
      if (typeof HistoryStore !== 'undefined') {
        HistoryStore.save(record).catch(() => {});
      }
      if (typeof reportCollect !== 'undefined') {
        reportCollect({
          time: new Date().toISOString(),
          meta: { ua: navigator.userAgent, trigger: 'ita', checkType: 'workhours' },
          project: record.project,
          run: {},
          stats: { users: members.length, fail },
        });
      }
    } catch (e) {
      setStatus(e.message || '工时检查失败。', true);
    } finally {
      busy = false;
      checkBtn.disabled = false;
      loadBtn.disabled = false;
      refreshPick();
    }
  });

  toleranceSel.addEventListener('change', () => {
    if (!members.length) return;
    const tol = Number(toleranceSel.value);
    members.forEach((m) => { m.checked = m.achievement_rate < 100 - tol; });
    renderMembers();
    tableTip.textContent = `误差线 ±${tol}%（可在上方切换）`;
  });

  checkAllBox.addEventListener('change', () => {
    members.forEach((m) => { m.checked = checkAllBox.checked; });
    renderMembers();
  });

  // ── ③ 复制邮箱 / 邮件文本 ──
  const copyText = async (text, tip) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setStatus(tip, false);
    } catch (e) {
      setStatus('复制失败：' + e.message, true);
    }
  };

  const pickedMembers = () => members.filter((m) => m.checked);

  copyMailBtn.addEventListener('click', () => {
    const picked = pickedMembers();
    if (!picked.length) return;
    const mails = picked.map((m) => `${m.id}${MAIL_DOMAIN}`).join(';');
    copyText(mails, `已复制 ${picked.length} 个邮箱，可粘贴到邮件收件人。`);
  });

  copyTextBtn.addEventListener('click', () => {
    const picked = pickedMembers();
    if (!picked.length) return;
    const projname = currentProj ? currentProj.projname : (projSelect.selectedOptions[0] || {}).textContent || '';
    const lines = [
      '各位同事，现《' + projname + '》临近结项，请各位按目标工时完成填报，不满足工时填报信息如下，请特别关注：',
      '（本数据为自动统计，如有偏差，请以实际填报为准！）',
      '项目名称: ' + projname,
    ];
    picked.forEach((m) => {
      lines.push(`${m.name}   已填报:${m.completed_amt}   目标填报:${m.target_amt}   完成率:${m.achievement_rate}%`);
    });
    copyText(lines.join('\r\n\r\n'), '已复制邮件文本，可粘贴到邮件正文。');
  });
});
