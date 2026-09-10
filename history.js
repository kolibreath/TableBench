// 检查历史页面脚本（模块归属：检查历史）
// 范围：仅规模估算书合规检查记录（type=estimation；doc_check/workhours 照常入库但不在本页展示）
// 结构：「列表 / 统计」双 Tab；统计 = 估算检查台账看板（月度趋势 / 违规趋势 / TOP 规则 / TOP 项目）
// 数据源优先后端 SQLite，回退 IndexedDB（common/store.js）

document.addEventListener('DOMContentLoaded', () => {
  const listArea = document.getElementById('listArea');
  const statsArea = document.getElementById('statsArea');
  const statsBox = document.getElementById('statsBox');
  const sourceFilter = document.getElementById('sourceFilter');
  const keywordInput = document.getElementById('keywordInput');
  const drawerMask = document.getElementById('drawerMask');
  const drawer = document.getElementById('drawer');
  const drawerBody = document.getElementById('drawerBody');
  const drawerTitle = document.getElementById('drawerTitle');

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const sourceTag = (r) => r.source === 'ita'
    ? '<span class="type-tag type-est-ita">后置（ITA）</span>'
    : '<span class="type-tag type-est-manual">前置（手动）</span>';

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

  // ── 基础数据：全部估算检查记录（列表/统计共用；列表再叠加来源+关键字过滤） ──
  let baseRecords = [];
  let baseSource = '';
  let currentTab = 'list';

  const loadBase = async () => {
    const { records, source } = await HistoryStore.list({ type: 'estimation' });
    baseRecords = prjidFilter
      ? records.filter((r) => r.project && String(r.project.prjid || '') === String(prjidFilter))
      : records;
    baseSource = source;
  };

  // ── 列表 ──
  const loadList = () => {
    const kw = (keywordInput.value || '').trim().toLowerCase();
    let records = baseRecords;
    if (sourceFilter.value !== '__ALL__') {
      records = records.filter((r) => r.source === sourceFilter.value);
    }
    if (kw) {
      records = records.filter((r) => {
        const hay = JSON.stringify({
          n: r.project && r.project.projname,
          p: r.project && r.project.projectno,
          f: (r.files || []).map((x) => x.name).join(','),
        }).toLowerCase();
        return hay.includes(kw);
      });
    }

    if (!records.length) {
      listArea.innerHTML = '<div class="empty">暂无估算检查记录。运行「规模估算书合规检查」（前置或后置）后会自动留存。</div>';
      statsBox.innerHTML = '';
      return;
    }

    // 统计条：共 N 条 · 本月检查 · 强制违例 · 覆盖项目
    const now = new Date();
    const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const monthCount = records.filter((r) => String(r.time || '').slice(0, 7) === curMonth).length;
    const mustCount = records.reduce((s, r) => s + ((r.summary || {}).must || 0), 0);
    const projSet = new Set(records.map((r) => r.project && r.project.projname).filter(Boolean));
    statsBox.innerHTML = `
      <span>共 <b>${records.length}</b> 条（${baseSource === 'backend' ? '本地服务' : '浏览器本地'}）</span>
      <span>本月检查 <b>${monthCount}</b> 次</span>
      <span>强制违例 <b class="v-must">${mustCount}</b> 项</span>
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
      return `
        <tr data-id="${r.id == null ? '' : r.id}">
          <td style="white-space:nowrap">${esc(r.time || '-')}</td>
          <td>${sourceTag(r)}</td>
          <td>
            <div class="proj-name">${esc(name)}</div>
            <div class="proj-sub">${sub || '&nbsp;'}</div>
          </td>
          <td>${esc(r.ruleVersion || '—')}</td>
          <td style="white-space:nowrap">
            <span class="${mustCls}">${s.must || 0}</span> /
            <span class="${sugCls}">${s.suggest || 0}</span> /
            <span class="${aiCls}">${s.ai || 0}</span>
          </td>
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
            <th style="width:110px">来源</th>
            <th>项目 / 文件</th>
            <th style="width:80px">规则版本</th>
            <th style="width:120px">违例（强制/建议/AI）</th>
            <th style="width:70px">耗时</th>
            <th style="width:150px">操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    listArea.querySelectorAll('tr[data-id]').forEach((tr) => {
      const idRaw = tr.dataset.id;
      const id = idRaw === '' ? null : Number(idRaw);
      tr.querySelector('.btn-detail').addEventListener('click', () => openDetail(id, records));
      tr.querySelector('.btn-del').addEventListener('click', async () => {
        if (!window.confirm('确认删除该条检查记录？')) return;
        await HistoryStore.remove(id);
        await refresh();
      });
    });
  };

  // ══════════ 统计看板：估算检查台账 ══════════

  const lastMonths = (n) => {
    const out = [];
    const d = new Date();
    d.setDate(1);
    for (let i = n - 1; i >= 0; i--) {
      const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'));
    }
    return out;
  };

  const monthOf = (r) => String(r.time || '').slice(0, 7);

  const renderStats = () => {
    const recs = baseRecords;
    if (!recs.length) {
      statsArea.innerHTML = '<div class="empty">暂无估算检查记录，统计看板将在首次检查后生成。</div>';
      return;
    }

    // ① 指标卡：总检查 / 本月（accent）/ 强制违例累计 / AI 不匹配累计
    const now = new Date();
    const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const total = recs.length;
    const monthCount = recs.filter((r) => monthOf(r) === curMonth).length;
    const mustTotal = recs.reduce((s, r) => s + ((r.summary || {}).must || 0), 0);
    const aiTotal = recs.reduce((s, r) => s + ((r.summary || {}).ai || 0), 0);
    document.getElementById('statCards').innerHTML = `
      <div class="scard"><div class="num">${total}</div><div class="lbl">累计检查（条）</div></div>
      <div class="scard accent"><div class="num">${monthCount}</div><div class="lbl">本月检查（${esc(curMonth)}）</div></div>
      <div class="scard"><div class="num">${mustTotal}</div><div class="lbl">强制违例累计（项）</div></div>
      <div class="scard"><div class="num">${aiTotal}</div><div class="lbl">AI 不匹配累计（项）</div></div>`;

    // ② 月度检查趋势（近 12 个月，前置/后置堆叠柱）
    const months = lastMonths(12);
    const byMonth = {};
    months.forEach((m) => { byMonth[m] = { manual: 0, ita: 0 }; });
    recs.forEach((r) => {
      const m = monthOf(r);
      if (byMonth[m]) byMonth[m][r.source === 'ita' ? 'ita' : 'manual']++;
    });
    const maxMonth = Math.max(1, ...months.map((m) => byMonth[m].manual + byMonth[m].ita));
    document.getElementById('monthCols').innerHTML = months.map((m) => {
      const d = byMonth[m];
      const totalM = d.manual + d.ita;
      const h = (v) => (totalM ? (v / maxMonth) * 100 : 0);
      return `
        <div class="col">
          <div class="plot">
            ${totalM ? `<div class="val">${totalM}</div>` : ''}
            <div class="stack" style="height:${totalM ? (totalM / maxMonth) * 82 : 1}%"
                 title="${m} 前置 ${d.manual} 次 · 后置 ${d.ita} 次">
              ${d.ita ? `<div class="seg-ita" style="height:${(h(d.ita) / (totalM / maxMonth) || 0)}%"></div>` : ''}
              ${d.manual ? `<div class="seg-manual" style="height:${(h(d.manual) / (totalM / maxMonth) || 0)}%"></div>` : ''}
            </div>
          </div>
          <div class="mon">${m.slice(5)}月</div>
        </div>`;
    }).join('');

    // ③ 违规趋势（SVG 双折线：必须 / 建议）
    const trendMust = months.map((m) => {
      const mm = recs.filter((r) => monthOf(r) === m);
      return mm.reduce((s, r) => s + ((r.summary || {}).must || 0), 0);
    });
    const trendSug = months.map((m) => {
      const mm = recs.filter((r) => monthOf(r) === m);
      return mm.reduce((s, r) => s + ((r.summary || {}).suggest || 0), 0);
    });
    const W = 560, H = 150, PADL = 26, PADB = 18, PADT = 10;
    const yMax = Math.max(1, ...trendMust, ...trendSug);
    const xAt = (i) => PADL + (i * (W - PADL - 8)) / (months.length - 1);
    const yAt = (v) => PADT + (1 - v / yMax) * (H - PADT - PADB);
    const line = (arr) => arr.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    const dots = (arr, color) => arr.map((v, i) =>
      `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="3" fill="#fff" stroke="${color}" stroke-width="2"><title>${months[i]}：${v}</title></circle>`).join('');
    document.getElementById('trendWrap').innerHTML = `
      <svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="违规趋势折线图">
        <line x1="${PADL}" y1="${yAt(0)}" x2="${W - 8}" y2="${yAt(0)}" stroke="rgba(0,0,0,.12)" stroke-width="1"/>
        <text x="4" y="${yAt(0) + 3}" font-size="9" fill="#8a9a8c">0</text>
        <text x="4" y="${yAt(yMax) + 3}" font-size="9" fill="#8a9a8c">${yMax}</text>
        ${months.map((m, i) => (i % 2 === 0
          ? `<text x="${xAt(i)}" y="${H - 4}" font-size="9" fill="#8a9a8c" text-anchor="middle">${m.slice(5)}月</text>` : '')).join('')}
        <polyline points="${line(trendMust)}" fill="none" stroke="#c62828" stroke-width="2"/>
        <polyline points="${line(trendSug)}" fill="none" stroke="#f9a825" stroke-width="2"/>
        ${dots(trendMust, '#c62828')}${dots(trendSug, '#f9a825')}
      </svg>
      <div class="axis-note" style="display:flex;gap:14px">
        <span><i class="lg-i" style="display:inline-block;width:9px;height:2px;background:#c62828;vertical-align:middle;margin-right:4px"></i>必须项</span>
        <span><i style="display:inline-block;width:9px;height:2px;background:#f9a825;vertical-align:middle;margin-right:4px"></i>建议项</span>
        <span>纵轴上限 ${yMax}</span>
      </div>`;

    // ④ TOP 问题规则（违例条数，含 AI）
    const ruleCount = {};
    recs.forEach((r) => {
      ((r.detail && r.detail.violations) || []).forEach((v) => {
        const key = v.source === 'ai' ? 'AI 比对' : (v.ruleId ? '规则 ' + v.ruleId : '未标注');
        ruleCount[key] = (ruleCount[key] || 0) + 1;
      });
    });
    const topRules = Object.entries(ruleCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxRule = Math.max(1, ...topRules.map(([, c]) => c));
    document.getElementById('topRules').innerHTML = topRules.length
      ? topRules.map(([label, c], i) => `
          <div class="hbar-row">
            <span class="rank">${String(i + 1).padStart(2, '0')}</span>
            <span class="hlabel" title="${esc(label)}">${esc(label)}</span>
            <div class="track"><div class="fill" style="width:${(c / maxRule) * 100}%"></div></div>
            <span class="hval">${c}</span>
          </div>`).join('')
      : '<div class="axis-note">暂无违例明细（记录可能为摘要）。</div>';

    // ⑤ TOP 问题项目（按违例总数 must+suggest+ai）
    const projCount = {};
    recs.forEach((r) => {
      const s = r.summary || {};
      const v = (s.must || 0) + (s.suggest || 0) + (s.ai || 0);
      const key = (r.project && (r.project.projname || r.project.prjid)) || fileNames(r)[0] || '未标注项目';
      projCount[key] = (projCount[key] || 0) + v;
    });
    const topProj = Object.entries(projCount).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxProj = Math.max(1, ...topProj.map(([, c]) => c));
    document.getElementById('topProjects').innerHTML = topProj.length
      ? topProj.map(([label, c], i) => `
          <div class="hbar-row fill-must">
            <span class="rank">${String(i + 1).padStart(2, '0')}</span>
            <span class="hlabel" title="${esc(label)}">${esc(label)}</span>
            <div class="track"><div class="fill" style="width:${(c / maxProj) * 100}%"></div></div>
            <span class="hval">${c}</span>
          </div>`).join('')
      : '<div class="axis-note">各项目均无违例，保持得很好。</div>';
  };

  // ── Tab 切换 ──
  const applyTab = () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
    const isList = currentTab === 'list';
    listArea.style.display = isList ? '' : 'none';
    statsArea.style.display = isList ? 'none' : 'block';
    // 统计视图下隐藏列表专属筛选（来源/关键字）
    sourceFilter.style.display = isList ? '' : 'none';
    keywordInput.style.display = isList ? '' : 'none';
    document.getElementById('searchBtn').style.display = isList ? '' : 'none';
    if (!isList) renderStats();
  };
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => { currentTab = b.dataset.tab; applyTab(); });
  });

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
        <div class="item"><b class="${s.ai ? 'v-ai' : ''}">${s.ai || 0}</b><br>AI</div>
        <div class="item"><b>${rec.durationSec != null ? rec.durationSec + 's' : '-'}</b><br>耗时</div>
      </div>
      ${proj.projname ? `<p style="font-size:13px;color:#555">项目：${esc(proj.projname)}（${esc(proj.projectno || '-')}）</p>` : ''}
      ${fileNames(rec).length ? `<p style="font-size:13px;color:#555">文件：${esc(fileNames(rec).join('、'))}</p>` : ''}
    `;

    // 违例表（按 Sheet+行）
    const violations = (rec.detail && rec.detail.violations) || [];
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

    return head + `
      <div class="detail-sec-title">违例明细（${violations.length} 条）</div>
      ${violations.length ? `<table class="vio"><thead><tr><th style="width:150px">Sheet</th><th style="width:60px">行</th><th>说明</th></tr></thead><tbody>${rowsHtml}</tbody></table>`
        : '<p style="color:#52c41a;font-size:13px">本次检查未发现违例。</p>'}`;
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
  sourceFilter.addEventListener('change', loadList);
  document.getElementById('refreshBtn').addEventListener('click', refresh);
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!window.confirm('确认清空全部检查历史？此操作不可恢复。')) return;
    await HistoryStore.remove(null);
    await refresh();
  });

  async function refresh() {
    await loadBase();
    if (currentTab === 'list') loadList();
    else renderStats();
  }

  refresh();
});
