// 检查历史页面脚本
// 列表 / 筛选 / 详情 / 删除 / 导出；数据源优先后端 SQLite，回退 IndexedDB（common/store.js）

document.addEventListener('DOMContentLoaded', () => {
  const listArea = document.getElementById('listArea');
  const statsBox = document.getElementById('statsBox');
  const typeFilter = document.getElementById('typeFilter');
  const sourceFilter = document.getElementById('sourceFilter');
  const keywordInput = document.getElementById('keywordInput');
  const drawerMask = document.getElementById('drawerMask');
  const drawer = document.getElementById('drawer');
  const drawerBody = document.getElementById('drawerBody');
  const drawerTitle = document.getElementById('drawerTitle');

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const typeTag = (r) => {
    if (r.type === 'estimation') {
      return r.source === 'ita'
        ? '<span class="type-tag type-est-ita">估算检查·后置</span>'
        : '<span class="type-tag type-est-manual">估算检查·前置</span>';
    }
    if (r.type === 'doc_check') return '<span class="type-tag type-doc-check">项目文档检查</span>';
    if (r.type === 'workhours') return '<span class="type-tag type-workhours">工时检查</span>';
    return '<span class="type-tag">' + esc(r.type || '未知') + '</span>';
  };

  const fileNames = (r) => (r.files || []).map((f) => f.name).filter(Boolean);

  // ── 项目深链过滤（?prjid=&projname=，由项目工作台「查看此项目历史」进入） ──
  const q = new URLSearchParams(location.search);
  const prjidFilter = (q.get('prjid') || '').trim();
  if (prjidFilter) {
    document.getElementById('projChipName').textContent = q.get('projname') || prjidFilter;
    document.getElementById('projChip').style.display = 'inline-flex';
    document.getElementById('projChipClose').addEventListener('click', () => {
      location.href = chrome.runtime.getURL('history.html');
    });
  }

  // ── 列表 ──
  const loadList = async () => {
    listArea.innerHTML = '<div class="empty">加载中…</div>';
    const filter = {
      type: typeFilter.value,
      source: sourceFilter.value,
      keyword: (keywordInput.value || '').trim(),
    };
    let { records, source } = await HistoryStore.list(filter);

    // 项目深链过滤（历史记录的 project.prjid）
    if (prjidFilter) {
      records = records.filter((r) => r.project && String(r.project.prjid || '') === String(prjidFilter));
    }

    if (!records.length) {
      listArea.innerHTML = '<div class="empty">暂无检查记录。运行「规模估算书合规检查」或「项目工作台 · 文档检查」后会自动留存。</div>';
      statsBox.innerHTML = '';
      return;
    }

    // 统计条：共 N 条 · 本月检查 · 不通过 · 覆盖项目
    const now = new Date();
    const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const monthCount = records.filter((r) => String(r.time || '').slice(0, 7) === curMonth).length;
    const failCount = records.reduce((s, r) => {
      const sm = r.summary || {};
      if (r.type === 'doc_check') return s + (sm.fail || 0);
      if (r.type === 'workhours') return s + (sm.fail || 0);
      return s + (sm.must || 0);
    }, 0);
    const projSet = new Set(records.map((r) => r.project && r.project.projname).filter(Boolean));
    statsBox.innerHTML = `
      <span>共 <b>${records.length}</b> 条（${source === 'backend' ? '本地服务' : '浏览器本地'}）</span>
      <span>本月检查 <b>${monthCount}</b> 次</span>
      <span>不通过 <b class="v-must">${failCount}</b> 项</span>
      <span>覆盖项目 <b>${projSet.size}</b> 个</span>`;

    const rows = records.map((r) => {
      const s = r.summary || {};
      const proj = r.project || {};
      const name = proj.projname || fileNames(r)[0] || '-';
      const sub = proj.projectno
        ? `编号 ${esc(proj.projectno)}${proj.projtype ? ' · ' + esc(proj.projtype) : ''}`
        : fileNames(r).slice(0, 3).map(esc).join('、') + (fileNames(r).length > 3 ? ' 等' : '');
      const mustCls = s.must ? 'v-num v-must' : 'v-num v-zero';
      const sugCls = s.suggest ? 'v-num v-suggest' : 'v-num v-zero';
      const aiCls = s.ai ? 'v-num v-ai' : 'v-num v-zero';
      const vioCell = r.type === 'workhours'
        ? `<span class="${s.fail ? 'v-num v-must' : 'v-num v-zero'}">${s.fail || 0}</span> 人不达标`
        : `<span class="${mustCls}">${s.must || 0}</span> /
            <span class="${sugCls}">${s.suggest || 0}</span>
            ${r.type === 'estimation' ? ' / <span class="' + aiCls + '">' + (s.ai || 0) + '</span>' : ''}`;
      return `
        <tr data-id="${r.id == null ? '' : r.id}">
          <td style="white-space:nowrap">${esc(r.time || '-')}</td>
          <td>${typeTag(r)}</td>
          <td>
            <div class="proj-name">${esc(name)}</div>
            <div class="proj-sub">${sub || '&nbsp;'}</div>
          </td>
          <td>${esc(r.ruleVersion || '—')}</td>
          <td style="white-space:nowrap">${vioCell}</td>
          <td>${r.durationSec != null ? r.durationSec + 's' : '-'}</td>
          <td class="row-actions" style="white-space:nowrap">
            <button class="btn ghost btn-detail">详情</button>
            <button class="btn danger btn-del">删除</button>
          </td>
        </tr>`;
    }).join('');

    listArea.innerHTML = `
      <table class="list">
        <thead>
          <tr>
            <th style="width:150px">时间</th>
            <th style="width:110px">类型</th>
            <th>项目 / 文件</th>
            <th style="width:80px">规则版本</th>
            <th style="width:130px">违例（强制/建议/AI）</th>
            <th style="width:70px">耗时</th>
            <th style="width:150px">操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    // 事件绑定
    listArea.querySelectorAll('tr[data-id]').forEach((tr) => {
      const idRaw = tr.dataset.id;
      const id = idRaw === '' ? null : Number(idRaw);
      tr.querySelector('.btn-detail').addEventListener('click', () => openDetail(id, records));
      tr.querySelector('.btn-del').addEventListener('click', async () => {
        if (!window.confirm('确认删除该条检查记录？')) return;
        await HistoryStore.remove(id);
        loadList();
      });
    });
  };

  // ── 详情 ──
  const openDetail = async (id, records) => {
    let rec = null;
    if (id != null) {
      rec = await HistoryStore.get(id);
    }
    if (!rec) {
      // 降级：chrome.storage 摘要记录没有完整 detail，从列表缓存中取
      rec = records.find((r) => r.id === id) || null;
    }
    if (!rec) return;

    drawerTitle.textContent = '检查详情 · ' + (rec.time || '');
    drawerBody.innerHTML = renderDetail(rec);
    drawerMask.style.display = 'block';
    drawer.style.display = 'flex';
  };

  const renderDetail = (rec) => {
    const s = rec.summary || {};
    const proj = rec.project || {};
    const head = `
      <div class="detail-summary">
        <div class="item"><b>${esc(rec.time || '-')}</b><br>检查时间</div>
        <div class="item"><b>${esc(rec.ruleVersion || '—')}</b><br>规则版本</div>
        <div class="item"><b class="${s.must ? 'v-must' : ''}">${s.must || 0}</b><br>强制</div>
        <div class="item"><b class="${s.suggest ? 'v-suggest' : ''}">${s.suggest || 0}</b><br>建议</div>
        ${rec.type === 'estimation' ? `<div class="item"><b class="${s.ai ? 'v-ai' : ''}">${s.ai || 0}</b><br>AI</div>` : ''}
        <div class="item"><b>${rec.durationSec != null ? rec.durationSec + 's' : '-'}</b><br>耗时</div>
      </div>
      ${proj.projname ? `<p style="font-size:13px;color:#555">项目：${esc(proj.projname)}（${esc(proj.projectno || '-')}）</p>` : ''}
      ${fileNames(rec).length ? `<p style="font-size:13px;color:#555">文件：${esc(fileNames(rec).join('、'))}</p>` : ''}
    `;

    // 估算检查：违例表（按 Sheet+行）
    const violations = (rec.detail && rec.detail.violations) || [];
    let vioHtml = '';
    if (rec.type === 'estimation') {
      const groups = {};
      violations.forEach((v) => {
        const key = (v.sheet || '?') + '|' + (v.row || '?');
        (groups[key] = groups[key] || []).push(v);
      });
      const rowsHtml = Object.keys(groups).sort((a, b) => {
        const [sa, ra] = a.split('|'); const [sb, rb] = b.split('|');
        return sa === sb ? (Number(ra) || 0) - (Number(rb) || 0) : sa.localeCompare(sb, 'zh');
      }).map((key) => {
        const items = groups[key];
        const lines = items.map((v) => {
          const cls = v.source === 'ai' ? 'badge-skip' : (v.type === '强制' ? 'badge-fail' : 'badge-pass');
          const tag = v.source === 'ai' ? '[AI] ' : (v.ruleId ? '[规则' + esc(v.ruleId) + '] ' : '');
          return `<div><span class="${cls}">${v.type === '强制' ? '✗' : '?'}</span> ${tag}${esc(v.message || v.text || '')}</div>` +
            (v.reason ? `<div class="ai-reason">AI 分析原因：${esc(v.reason)}</div>` : '');
        }).join('');
        return `<tr><td style="white-space:nowrap">${esc(items[0].sheet || '?')}</td><td>${esc(items[0].row || '?')}</td><td>${lines}</td></tr>`;
      }).join('');
      vioHtml = `
        <div class="detail-sec-title">违例明细（${violations.length} 条）</div>
        ${violations.length ? `<table class="vio"><thead><tr><th style="width:150px">Sheet</th><th style="width:60px">行</th><th>说明</th></tr></thead><tbody>${rowsHtml}</tbody></table>`
          : '<p style="color:#52c41a;font-size:13px">本次检查未发现违例。</p>'}`;
    }

    // 项目自查：文档卡片结果
    const docs = (rec.detail && rec.detail.documents) || [];
    let docHtml = '';
    if (rec.type === 'doc_check') {
      docHtml = `<div class="detail-sec-title">自查结果（${docs.length} 份文档）</div>` + (docs.map((d) => {
        const results = (d.results || []).map((r) => {
          const cls = r.status === '通过' ? 'badge-pass' : (r.status === '不通过' ? 'badge-fail' : 'badge-skip');
          return `<div style="margin:4px 0"><span class="${cls}">[${esc(r.status)}]</span> ${esc(r.op)}：${esc(r.detail || '')}</div>` +
            (r.example ? `<div style="color:#999;font-size:12px">依据：${esc(r.example)}</div>` : '');
        }).join('');
        return `<div style="border:1px solid #eef1f6;border-radius:8px;padding:10px 12px;margin-bottom:8px">
            <b style="font-size:13px">${esc(d.name)}</b> <span class="source-tag">${esc(d.checkType || '')}</span>
            ${d.error ? `<div class="badge-fail">打开失败：${esc(d.error)}</div>` : results}
          </div>`;
      }).join('') || '<p style="color:#999;font-size:13px">无明细（记录为摘要）</p>');
    }

    // 工时检查：成员完成率表
    const whMembers = (rec.detail && rec.detail.members) || [];
    let whHtml = '';
    if (rec.type === 'workhours') {
      const tol = (rec.detail && rec.detail.tolerance) != null ? rec.detail.tolerance : 3;
      const rowsHtml = whMembers.map((m) => {
        const cls = m.achievement_rate < 100 - tol ? 'badge-fail'
          : (m.achievement_rate > 100 + tol ? 'badge-skip' : 'badge-pass');
        return `<tr><td>${esc(m.name || '-')}</td><td>${esc(m.id || '')}@abchina.com.cn</td>
            <td style="text-align:right">${m.completed_amt}</td><td style="text-align:right">${m.target_amt}</td>
            <td><span class="${cls}">${m.achievement_rate}%</span></td></tr>`;
      }).join('');
      whHtml = `
        <div class="detail-sec-title">成员工时（误差线 ±${tol}%，共 ${whMembers.length} 人）</div>
        ${whMembers.length ? `<table class="vio"><thead><tr><th>姓名</th><th>邮箱</th><th style="width:100px">已填报</th><th style="width:100px">目标</th><th style="width:80px">完成率</th></tr></thead><tbody>${rowsHtml}</tbody></table>`
          : '<p style="color:#999;font-size:13px">无成员明细。</p>'}`;
    }

    return head + vioHtml + docHtml + whHtml;
  };

  const closeDrawer = () => {
    drawerMask.style.display = 'none';
    drawer.style.display = 'none';
  };
  document.getElementById('drawerClose').addEventListener('click', closeDrawer);
  drawerMask.addEventListener('click', closeDrawer);

  // ── 工具栏 ──
  document.getElementById('searchBtn').addEventListener('click', loadList);
  keywordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') loadList(); });
  typeFilter.addEventListener('change', loadList);
  sourceFilter.addEventListener('change', loadList);
  document.getElementById('refreshBtn').addEventListener('click', loadList);

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const jsonl = await HistoryStore.exportJsonl();
    const blob = new Blob([jsonl || ''], { type: 'application/jsonl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '检查历史_' + new Date().toISOString().slice(0, 10) + '.jsonl';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!window.confirm('确认清空全部检查历史？此操作不可恢复。')) return;
    await HistoryStore.remove(null);
    loadList();
  });

  loadList();
});
