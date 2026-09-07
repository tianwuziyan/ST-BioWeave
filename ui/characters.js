const characterDetailTabs = [
  ['state', '状态'],
  ['events', '事件'],
  ['projection', '推演'],
  ['relations', '关系'],
  ['notes', '备注'],
];

const characterDetailContent = {
  state: ['状态', '这里将展示由 World Model 定义的身体、生殖能力、周期和特殊机制。当前为 UI 占位。'],
  events: ['事件', '这里将展示参与者包含该 character_id 的 Chat-level 历史事件。当前为 UI 占位。'],
  projection: ['推演', '这里将展示关联该 character_id 的 Active Projection。推演并非已发生事实。'],
  relations: ['关系', '这里将展示父母、子女和其他由关系图推导的关联。当前为 UI 占位。'],
  notes: ['备注', '这里将展示人物备注。当前为 UI 占位，不写入业务数据库。'],
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function detailPage(characterId, activeTab) {
  const tab = characterDetailContent[activeTab] ? activeTab : 'state';
  const [title, description] = characterDetailContent[tab];
  const safeCharacterId = escapeHtml(characterId);
  const buttons = characterDetailTabs.map(([id, label]) => '<button type="button" role="tab" data-character-tab="' + id + '" aria-selected="' + String(id === tab) + '" class="' + (id === tab ? 'active' : '') + '">' + label + '</button>').join('');
  return '<section class="bioweave-page bioweave-character-detail">'
    + '<div class="bioweave-page-title"><div><button type="button" class="bioweave-back" data-back-to-characters>← 返回人物列表</button><h2>人物详情</h2><p class="bioweave-muted">人物 ID：' + safeCharacterId + ' · 当前 Chat</p></div></div>'
    + '<section class="bioweave-card bioweave-character-summary"><header><b>演示人物</b><span class="bioweave-badge">占位 DTO</span></header><p class="bioweave-muted">此人物仅用于预览人物详情路由壳，不代表真实分析结果。</p></section>'
    + '<div class="bioweave-character-tabs" role="tablist" aria-label="人物详情分区">' + buttons + '</div>'
    + '<section class="bioweave-card bioweave-detail-section"><h3>' + title + '</h3><p class="bioweave-muted">' + description + '</p><div class="bioweave-empty">业务 selector 尚未接入。</div></section>'
    + '</section>';
}

export function charactersPage({characterId = null, characterDetailTab = 'state'} = {}) {
  if (characterId) return detailPage(characterId, characterDetailTab);
  return '<section class="bioweave-page"><div class="bioweave-page-title"><div><h2>人物列表</h2><p class="bioweave-muted">当前 Chat 中已识别的可追踪人物</p></div></div>'
    + '<div class="bioweave-toolbar"><input class="bioweave-input" placeholder="搜索人物……" aria-label="搜索人物"><button class="bioweave-select" type="button">全部状态 ▾</button><button class="bioweave-select" type="button">生殖能力 ▾</button><button class="bioweave-select" type="button">特殊状态 ▾</button></div>'
    + '<button type="button" class="bioweave-card bioweave-character-row" data-character-id="demo-character-1"><span><b>演示人物</b><small class="bioweave-muted">稳定 character_id：demo-character-1</small></span><span class="bioweave-character-state">占位预览　›</span></button>'
    + '<div class="bioweave-card bioweave-empty">尚未接入真实人物 selector。上方演示行只用于验证人物详情路由，不创建业务数据。</div></section>';
}
