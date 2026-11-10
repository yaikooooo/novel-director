import { designFrames, observedStatus } from '/contract.mjs';

const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const statusNames = {
  adopted: '采用', accepted: '采用', pass: '采用', approved: '已审定',
  needs_revision: '待修', needs_fix: '待修', blocked: '工具拦截',
  generated: '已生成 · 待采用', required_not_generated: '待生成',
  working: '设计中', review_ready: '待审', pending: '待生成',
};
const labels = {
  description: '说明', start: '入镜', progression_and_end: '发展与出镜',
  position_m: '计划位置 / 米', target_m: '拍向目标 / 米', basis: '依据',
  placement: '位置与高度', view_direction: '拍向', perspective_intent: '透视意图',
  motion: '摄影机运动', focus: '焦点', subject: '关注对象', mode: '方式',
  pov: '视点', owner: '所属人物', handheld: '手持', enabled: '启用',
  scale_in: '计划景别', scale_out: '落幅景别', frame_description: '构图',
  crop_continuity: '裁切连续', board_adoption_note: '采用决定', type: '类型',
  incoming: '入镜接法', in_state: '入镜状态', out_state: '出镜状态',
  out_reason: '切出理由', attention_handoff: '注意承接', overlap_frames: '重叠帧',
  previous: '前镜', next: '后镜', source_ref: '来源', state_source_ref: '状态来源',
  spatial_anchors: '空间锚点', frame: '全局帧', event: '事件', time_sec: '时间 / 秒',
  entry: '进入状态', change_and_carry: '变化与承接', continuity: '连续状态',
  intent: '观看任务', viewpoint: '观看立场', knowledge_change: '信息变化',
  strategy: '镜组策略', adaptation: '镜组组织', axis_ref: '关系轴',
  notes: '观察', crop_decision: '画框取舍', scope: '查看范围', status: '状态',
  source: '来源', text: '原文', frame_range: '全局帧段', timecode: '时码',
  accent_frames: '重音帧', listening_and_continuity: '听点与衔接',
  source_design_revision: '依据设计版本', aligned_design_revision: '对应设计版本',
  generation: '生成输入', references: '实际参考', correction_references: '修正参考',
  prompt: '生成提示词', correction_prompt: '修正提示词', image_ref: '原图',
  role: '用途', sheet_ref: '原页', panel_id: '格位', source_design: '设计依据',
  kind: '类别', name: '名称', coordinate_system: '坐标约定', origin: '原点',
  axes: '关系轴', camera_plans: '计划机位', anchors_m: '地标位置 / 米',
  asset_bindings: '资产引用', state_refs: '现场状态', motion_routes: '计划动线',
  validation: '验证记录', engine: '工程', files: '成果', modules: '模块',
  lighting_ref: '灯组', look_ref: '成像方案', effects: '效果',
};
const state = {
  id: new URLSearchParams(location.search).get('chapter') || 'example',
  payload: null, frames: [], pages: [], index: 0, pageId: null,
  mode: 'frame', source: 'board', detail: 'direction', query: '', zoom: 1,
  docs: false, docName: '', request: 0,
};

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  return node;
}

function svgElement(tag, attributes) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function design() { return state.payload?.document?.design || {}; }
function project() { return design().project || {}; }
function fps() { return project().fps ? project().fps.num / project().fps.den : 24; }
function current() {
  const frame = state.frames[state.index];
  return { frame, shot: frame && design().shots[frame.shot_id],
    sheet: frame?.sheet_ref && design().board_sheets[frame.sheet_ref] };
}
function displayTime(frame) {
  const rate = fps();
  if (!Number.isInteger(rate)) return ((frame - 1) / rate).toFixed(3) + 's';
  const total = frame - 1;
  return [Math.floor(total / rate / 60), Math.floor(total / rate) % 60, total % rate]
    .map(number => String(number).padStart(2, '0')).join(':');
}
function rangeText(range) {
  return range ? displayTime(range[0]) + ' — ' + displayTime(range[1] + 1) : '';
}
function assetURL(ref) {
  if (!ref || typeof ref !== 'string') return '';
  try {
    const url = new URL(ref.replaceAll('\\', '/'), new URL(state.payload.base, location.origin));
    return url.origin === location.origin && url.pathname.startsWith('/files/') ? url.href : '';
  } catch { return ''; }
}
function statusClass(status) {
  if (['accepted', 'pass', 'approved'].includes(status)) return 'adopted';
  return status === 'needs_fix' ? 'needs_revision' : status;
}
function badge(status) { return el('span', 'status ' + statusClass(status), statusNames[status] || status || '待生成'); }
function syncRoute() {
  const id = state.mode === 'page' ? state.pageId : current().frame?.id;
  const url = '/?chapter=' + encodeURIComponent(state.id) +
    (state.source !== 'board' ? '&view=' + state.source : '') + (id ? '#' + encodeURIComponent(id) : '');
  history.replaceState(null, '', url);
}
async function getJSON(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '读取失败');
  return data;
}
function errorMessage(message) {
  $('loadError').hidden = !message;
  $('loadError').textContent = message;
}

async function loadLibrary() {
  const { chapters } = await getJSON('/api/library');
  const select = $('chapterSelect');
  select.replaceChildren();
  for (const chapter of chapters) {
    const option = el('option', '', chapter.title + ' / ' + chapter.chapter);
    option.value = chapter.id;
    select.append(option);
  }
  select.value = state.id;
  if (!select.value) { state.id = 'example'; select.value = 'example'; }
}

async function loadChapter(preserve = false) {
  const request = ++state.request;
  const prior = preserve ? current().frame?.id : decodeURIComponent(location.hash.slice(1));
  errorMessage('');
  try {
    const payload = await getJSON('/api/chapter?id=' + encodeURIComponent(state.id));
    if (request !== state.request) return;
    state.payload = payload;
    state.frames = designFrames(payload.document);
    state.pages = Object.keys(design().board_sheets || {}).sort((left, right) => {
      const first = id => state.frames.findIndex(frame => frame.sheet_ref === id);
      return first(left) - first(right);
    });
    state.index = Math.max(0, state.frames.findIndex(frame => frame.id === prior || frame.shot_id === prior));
    if (state.pages.includes(prior)) { state.pageId = prior; state.mode = 'page'; }
    else { state.pageId = current().frame?.sheet_ref || state.pages[0]; if (!preserve) state.mode = 'frame'; }
    state.docs = !payload.document;
    if (!preserve) { state.source = new URLSearchParams(location.search).get('view') === 'formal' ? 'formal' : 'board'; state.zoom = 1; }
    renderHeader();
    render();
    if (state.docs) renderDocuments();
  } catch (error) { if (request === state.request) errorMessage('无法读取章节。' + error.message); }
}

function renderHeader() {
  $('workName').textContent = project().title || state.id.split('/')[0];
  $('chapterName').textContent = project().chapter || state.id.split('/').at(-1);
  const shots = Object.values(design().shots || {}).filter(shot => shot.kind === 'camera');
  const duration = project().frame_range ? (project().frame_range[1] - project().frame_range[0] + 1) / fps() : 0;
  $('chapterMeta').textContent = shots.length ? shots.length + ' 镜 · ' + duration.toFixed(1) + ' 秒 · ' + fps() + ' fps · ' + (project().aspect_ratio || '') : '章节文稿';
  $('counts').replaceChildren();
  const counts = state.payload.counts;
  for (const [key, label, style] of [
    ['adopted', '幅采用', 'adopted'], ['needs_revision', '幅待修', 'revision'],
    ['blocked', '幅受阻', ''], ['pending', '幅待完成', ''],
  ]) {
    if (!counts[key] && key !== 'adopted') continue;
    const count = el('div', 'count ' + style);
    count.append(el('strong', '', counts[key]), el('span', '', label));
    $('counts').append(count);
  }
  $('exampleNote').hidden = !state.payload.example;
  $('revision').textContent = state.payload.document ?
    (statusNames[state.payload.document.design_status] || '') + ' · 设计 v' + state.payload.document.design_revision +
      ' · 数据 v' + state.payload.document.data_revision + ' · 刷新时读取章节原件' : '读取章节原件';
  $('sourceData').href = state.payload.design_url;
  $('sourceData').hidden = !state.payload.document;
  $('contractIssues').hidden = !state.payload.issues.length;
  $('issueSummary').textContent = state.payload.issues.length + ' 项数据需要处理';
  $('issueList').replaceChildren(...state.payload.issues.map(issue => el('p', '', issue.field + ' · ' + issue.message)));
  document.title = $('chapterName').textContent + ' · 导演阅读器';
}

function renderList() {
  const list = $('shotList');
  list.replaceChildren();
  const selected = current().frame?.shot_id;
  for (const [groupId, group] of Object.entries(design().shot_groups || {})) {
    const matches = (group.shot_ids || []).filter(id => {
      const shot = design().shots?.[id];
      if (!shot) return false;
      const cues = (shot.sound_cues || []).map(cue => design().sound_timeline?.[cue.cue_ref]);
      return !state.query || JSON.stringify([id, shot, cues]).toLowerCase().includes(state.query.toLowerCase());
    });
    if (!matches.length) continue;
    list.append(el('h2', 'group-heading', groupId + ' · ' + (group.intent || group.name || '')));
    for (const id of matches) {
      const shot = design().shots[id];
      const frames = shot.design_frames || [];
      const statuses = frames.map(observedStatus);
      const status = statuses.includes('needs_revision') ? 'needs_revision' :
        statuses.includes('blocked') ? 'blocked' : statuses[0];
      const button = el('button', 'shot-button' + (id === selected ? ' active' : ''));
      button.dataset.shot = id;
      const top = el('div', 'shot-top');
      top.append(el('span', 'dot ' + statusClass(status)), el('strong', '', id),
        el('span', '', shot.kind === 'black' ? '黑场' : shot.composition?.scale_in || ''));
      button.append(top, el('p', 'shot-description', shot.intent || ''));
      list.append(button);
    }
  }
  if (!list.children.length) list.append(el('p', 'muted', state.query ? '没有匹配的镜头' : '本章尚无拍摄设计'));
}

function imageSVG(sheet, region, hotspots = false, annotate = true) {
  const box = region || [0, 0, sheet.width_px, sheet.height_px];
  const svg = svgElement('svg', { viewBox: box.join(' '), width: box[2], height: box[3],
    role: 'img', 'aria-label': region ? '关键画面 ' + current().frame.id : '原页 ' + state.pageId });
  const image = svgElement('image', { href: assetURL(sheet.image_ref), x: 0, y: 0,
    width: sheet.width_px, height: sheet.height_px });
  image.addEventListener('error', () => errorMessage('原图加载失败，请检查章节素材引用 ' + sheet.image_ref));
  svg.append(image);
  if (hotspots) {
    for (const frame of state.frames.filter(frame => frame.sheet_ref === state.pageId)) {
      const [x, y, width, height] = frame.panel_region;
      const link = svgElement('a', { href: '#' + frame.id, 'aria-label': '查看 ' + frame.id });
      link.dataset.frame = frame.id;
      link.append(svgElement('rect', { x, y, width, height,
        class: 'hotspot' + (frame.id === current().frame?.id ? ' selected' : '') }));
      const title = svgElement('title', {});
      title.textContent = frame.id + ' · ' + (statusNames[observedStatus(frame)] || '');
      link.append(title); svg.append(link);
    }
  }
  if ($('annotations').checked && annotate) {
    const frames = hotspots ? state.frames.filter(frame => frame.sheet_ref === state.pageId) : [current().frame];
    for (const frame of frames) addAnnotations(svg, frame);
  }
  return svg;
}

function addAnnotations(svg, frame) {
  if (!frame?.panel_region || !frame.annotations?.length) return;
  const [x, y, width, height] = frame.panel_region;
  const fontSize = Math.max(10, width * .024);
  for (const [index, annotation] of frame.annotations.entries()) {
    const color = annotation.kind === 'camera' ? '#426a9a' : '#aa553f';
    const markerId = 'arrow-' + frame.id + '-' + index;
    const marker = svgElement('marker', { id: markerId, viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }));
    const defs = svgElement('defs', {}); defs.append(marker); svg.append(defs);
    if (annotation.points?.length > 1) {
      svg.append(svgElement('polyline', {
        points: annotation.points.map(point => [x + point[0] * width, y + point[1] * height].join(',')).join(' '),
        stroke: color, 'stroke-width': width * .004, fill: 'none',
        'stroke-dasharray': annotation.kind === 'camera' ? '9 5' : '',
        'marker-end': 'url(#' + markerId + ')', 'pointer-events': 'none',
      }));
    }
    const at = annotation.label_at || annotation.points?.[0] || [.05, .1];
    const text = svgElement('text', { x: x + at[0] * width, y: y + at[1] * height,
      fill: color, 'font-size': fontSize, 'font-family': 'sans-serif', 'paint-order': 'stroke',
      stroke: '#fffefb', 'stroke-width': 4, 'pointer-events': 'none' });
    text.textContent = (annotation.kind === 'camera' ? '机位 · ' : annotation.kind === 'action' ? '动作 · ' : '') + annotation.label;
    svg.append(text);
  }
}

function emptyArt(title, text) {
  const box = el('div', 'empty-art');
  box.append(el('strong', '', title), el('p', '', text || ''));
  $('art').append(box);
}

function renderImage() {
  const { frame, shot, sheet } = current();
  const art = $('art');
  art.replaceChildren();
  $('original').hidden = true;
  $('frameNotice').hidden = true;
  $('imageCaption').textContent = '';
  $('frameLabel').textContent = frame ? frame.id + ' / ' + (shot.composition?.scale_in || '黑场') : '';
  $('frameTiming').textContent = shot ? rangeText(shot.frame_range) : '';
  $('frameStatus').replaceWith(Object.assign(badge(frame?.is_black ? '黑场' : observedStatus(frame || {})), { id: 'frameStatus' }));
  if (!frame) { emptyArt('等待拍摄设计', '可先从章节文稿与原件阅读已有内容。'); return; }
  if (frame.is_black && state.mode !== 'page') {
    art.append(el('div', 'black-art')); $('imageCaption').textContent = '黑场按原时间线显示'; return;
  }
  if (state.source === 'board') {
    const page = state.mode === 'page' ? design().board_sheets?.[state.pageId] : sheet;
    if (!page) {
      emptyArt(observedStatus(frame) === 'blocked' ? '该格受阻，尚未生成' : '该格等待制作',
        frame.requirement || shot.intent);
      $('imageCaption').textContent = frame.observation?.notes || '画面需求与时码已保留';
      return;
    }
    art.append(imageSVG(page, state.mode === 'page' ? null : frame.panel_region, state.mode === 'page'));
    $('original').href = assetURL(page.image_ref); $('original').hidden = false;
    $('imageCaption').textContent = state.mode === 'page' ?
      '原页 ' + state.pageId + ' · 点击画格进入逐镜' :
      frame.sheet_ref + ' / ' + frame.panel_id + ' · 代表帧 F' + frame.representative_frame;
    const status = state.mode === 'page' ? page.status : observedStatus(frame);
    if (['needs_revision', 'needs_fix'].includes(status)) {
      $('frameNotice').hidden = false;
      $('frameNotice').textContent = state.mode === 'page' ? page.observation :
        frame.observation?.notes || '本幅待修，请查看状态记录。';
    }
  } else if (state.source === 'formal') {
    const boardArt = frame.board_art;
    if (!boardArt) { emptyArt('正式分镜待交付', frame.requirement); return; }
    const img = el('img');
    img.src = assetURL(boardArt); img.alt = frame.id + ' 正式分镜';
    art.append(img); $('original').href = img.src; $('original').hidden = false;
    $('imageCaption').textContent = '代表帧 F' + frame.representative_frame;
  }

  applyZoom();
}

function applyZoom() {
  $('art').style.width = Math.round(state.zoom * 100) + '%';
}
function renderFrameText() {
  $('intent').textContent = current().shot?.intent || '';
  $('composition').textContent = current().shot?.composition?.frame_description || '';
}
function renderChips() {
  const { frame } = current();
  const chips = $('frameChips');
  chips.replaceChildren();
  const items = state.mode === 'page' ? state.frames.filter(item => item.sheet_ref === state.pageId) :
    state.frames.filter(item => item.shot_id === frame?.shot_id);
  for (const item of items) {
    const button = el('button', item.id === frame?.id ? 'active' : '', item.id);
    button.dataset.frame = item.id;
    button.append(el('small', '', 'F' + item.representative_frame));
    chips.append(button);
  }
  const position = state.mode === 'page' ? state.pages.indexOf(state.pageId) : state.index;
  const length = state.mode === 'page' ? state.pages.length : state.frames.length;
  $('previous').disabled = position <= 0;
  $('next').disabled = position >= length - 1;
  $('previous').textContent = state.mode === 'page' ? '← 上一页' : '← 上一幅';
  $('next').textContent = state.mode === 'page' ? '下一页 →' : '下一幅 →';
}

function scalar(value) {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === null) return '尚未记录';
  return statusNames[value] || String(value);
}
function objectFields(value) {
  const body = el('div');
  if (value === undefined) { body.append(el('p', 'muted', '尚未记录')); return body; }
  if (value === null || typeof value !== 'object') { body.append(el('p', '', scalar(value))); return body; }
  if (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object')) {
    body.append(el('p', '', value.map(scalar).join(' · '))); return body;
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    const field = el('div', 'field');
    const name = labels[key] || key;
    if (item && typeof item === 'object') {
      const details = el('details');
      details.append(el('summary', '', name), objectFields(item));
      field.append(details);
    } else {
      field.append(el('b', '', name), el('p', '', scalar(item)));
      if (typeof item === 'string' && /\.(png|jpe?g|webp|svg|md|pdf|mp4|blend|json)$/i.test(item)) {
        const url = assetURL(item);
        if (url) { const link = el('a', '', '打开原件 ↗'); link.href = url; link.target = '_blank'; field.append(link); }
      }
    }
    body.append(field);
  }
  return body;
}
function section(title, value, collapse = false) {
  const box = el('section', 'detail-section');
  if (collapse) {
    const details = el('details');
    details.append(el('summary', '', title), objectFields(value)); box.append(details);
  } else { box.append(el('h3', '', title), objectFields(value)); }
  return box;
}

function renderDetails() {
  const body = $('detailBody');
  body.replaceChildren();
  const { frame, shot, sheet } = current();
  if (!shot) { body.append(section('章节资料', '本章的文稿可从左侧入口阅读。')); return; }
  const group = design().shot_groups?.[shot.group_ref] || {};
  const scene = design().scenes?.[shot.scene_ref] || {};
  const motionDesign = state.payload.document.motion_design;
  const motion = motionDesign?.shots?.[frame.shot_id];
  const motionSummary = motion?.intent || '待 07 设计运镜提示词';
  if (state.detail === 'motion') {
    if (frame.is_black) { body.append(section('黑场', '沿剪辑时码显示黑场。')); return; }
    if (!motion) { body.append(section('运镜提示词', '待 07 根据正式分镜设计。')); return; }
    body.append(section('导演意图', motion.intent));
    const referenceTime = (frame.representative_frame - shot.frame_range[0]) / fps();
    body.append(section('参考画面', frame.id + ' · 本镜 ' +
      ((shot.frame_range[1] - shot.frame_range[0] + 1) / fps()).toFixed(2) +
      ' 秒 · 正式图对应镜内约 ' + referenceTime.toFixed(2) + ' 秒'));
    const promptBox = section('完整运镜提示词', motion.prompt);
    promptBox.dataset.motionPrompt = frame.shot_id;
    const copy = el('button', '', '复制提示词');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(motion.prompt); copy.textContent = '已复制'; }
      catch { copy.textContent = '请选中文本复制'; }
    });
    promptBox.append(copy); body.append(promptBox);
    body.append(section('设计状态', {
      status: motionDesign.status,
      source_design_revision: motionDesign.source_design_revision,
      notes: motionDesign.source_design_revision === state.payload.document.design_revision
        ? '当前为提示词设计，依据对应版本的正式分镜。' : '分镜设计已变更，提示词待同步。'
    }), section('设计自检', motionDesign.review, true));
    return;
  }
  if (state.detail === 'direction') {
    body.append(section('观看任务', shot.intent),
      section('构图与景别', shot.composition),
      ...(frame.is_black ? [] : [section('运镜意图', motionSummary)]),
      section('连续动作', shot.blocking),
      section('切点与承接', shot.edit),
      section('关键事件', shot.anchors, true),
      section('光影与色彩', { 灯组: design().lighting_setups?.[shot.lighting_ref],
        成像: design().look_setups?.[shot.look_ref], 效果: shot.effects }, true),
      section('本组观看关系', group, true),
      section('完整镜头记录', shot, true));
  } else if (state.detail === 'sound') {
    if (!shot.sound_cues?.length) body.append(section('声音文字', shot.kind === 'black' ? '本段为黑场，沿设计记录收声。' : '本镜尚未登记声音。'));
    for (const active of shot.sound_cues || []) {
      const cue = design().sound_timeline?.[active.cue_ref];
      if (!cue) continue;
      const card = el('section', 'cue');
      const head = el('div', 'cue-head');
      head.append(el('strong', '', cue.source || active.cue_ref), el('span', '', rangeText(active.active_frame_range)));
      card.append(head, el('p', '', cue.text),
        el('small', '', (active.continues_from_previous ? '承前镜延续' : '本镜进入') + ' · ' +
          (active.continues_to_next ? '延续至后镜' : '本镜结束')));
      if (cue.listening_and_continuity) card.append(el('p', '', cue.listening_and_continuity));
      card.append(section('完整声点', cue, true));
      body.append(card);
    }
  } else if (state.detail === 'space') {
    if (!frame.is_black) {
      body.append(section('代表机位', shot.camera?.placement || '依正式分镜的静态视点'),
        section('拍向与运动', { 拍向: shot.camera?.view_direction, 运镜: motionSummary, 提示词: motion?.prompt }));
    }
    if (scene.plan_ref) {
      const region = scene.plan_regions?.[shot.group_ref];
      const dimensions = scene.plan_size;
      if (region && dimensions) {
        const sheet = { image_ref: scene.plan_ref, width_px: dimensions[0], height_px: dimensions[1] };
        const svg = imageSVG(sheet, region, false, false);
        svg.setAttribute('aria-label', '本镜组计划机位');
        svg.classList.add('plan-image'); body.append(svg);
      } else {
        const image = el('img', 'plan-image');
        image.src = assetURL(scene.plan_ref); image.alt = '计划机位图'; body.append(image);
      }
      const link = el('a', '', '打开完整机位图 ↗');
      link.href = assetURL(scene.plan_ref); link.target = '_blank'; body.append(link);
    }
    body.append(section('轴线与变化', { axis_ref: shot.axis_ref, 轴线事件: shot.axis_events }),
      section('现场状态', scene.state_refs?.[shot.blocking?.state_source_ref] || group.continuity),
      section('场地与资产', scene, true));
  } else {
    body.append(section('本幅状态', { status: frame.is_black ? '黑场' : observedStatus(frame), ...frame.observation }),
      section('原页观察', sheet?.observation),
      section('采用的生成输入', sheet?.generation, true),
      section('本步结论', design().review?.board || design().review?.plan),
      section('完整设计检查记录', design().review, true),
      section('运镜设计检查', motionDesign?.review, true));
  }
}

function render() {
  $('imageReading').hidden = state.docs;
  $('documentReading').hidden = !state.docs;
  document.querySelectorAll('[data-source]').forEach(button => button.classList.toggle('active', button.dataset.source === state.source && !state.docs));
  document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === state.mode));
  document.querySelectorAll('[data-detail]').forEach(button => button.classList.toggle('active', button.dataset.detail === state.detail));
  $('modeButtons').hidden = state.source !== 'board' || state.docs;
  renderList();
  if (!state.docs) { renderImage(); renderChips(); renderFrameText(); }
  renderDetails(); syncRoute();
}
function chooseFrame(id) {
  const index = state.frames.findIndex(frame => frame.id === id || frame.shot_id === id);
  if (index < 0) return;
  state.index = index; state.mode = 'frame'; state.docs = false; state.zoom = 1;
  state.pageId = current().frame.sheet_ref || state.pageId;
  render();
}
function choosePage(id) {
  if (!state.pages.includes(id)) return;
  state.pageId = id; state.mode = 'page'; state.source = 'board'; state.docs = false; state.zoom = 1;
  if (current().frame?.sheet_ref !== id) state.index = state.frames.findIndex(frame => frame.sheet_ref === id);
  render();
}
function step(delta) {
  if (state.mode === 'page') {
    const index = Math.max(0, Math.min(state.pages.length - 1, state.pages.indexOf(state.pageId) + delta));
    choosePage(state.pages[index]);
  } else {
    const index = Math.max(0, Math.min(state.frames.length - 1, state.index + delta));
    if (state.frames[index]) chooseFrame(state.frames[index].id);
  }
}

function inlineMarkdown(node, text, sourceURL) {
  const pattern = /(!?\[[^\]]*\]\(<?[^)\n]+>?\)|\*\*[^*]+\*\*|`[^`]+`)/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    node.append(document.createTextNode(text.slice(start, match.index)));
    const token = match[0];
    if (token.startsWith('**')) node.append(el('strong', '', token.slice(2, -2)));
    else if (token.startsWith(String.fromCharCode(96))) node.append(el('code', '', token.slice(1, -1)));
    else {
      const parts = /^(!?)\[([^\]]*)\]\(<?(.*?)>?\)$/.exec(token);
      let url;
      try { url = new URL(parts[3], sourceURL); } catch {}
      if (!url || !['http:', 'https:'].includes(url.protocol)) node.append(document.createTextNode(token));
      else if (parts[1]) {
        if (url.origin === location.origin) { const image = el('img'); image.src = url.href; image.alt = parts[2]; node.append(image); }
      } else {
        const link = el('a', '', parts[2]); link.href = url.href; link.target = '_blank'; link.rel = 'noopener'; node.append(link);
      }
    }
    start = match.index + token.length;
  }
  node.append(document.createTextNode(text.slice(start).replace(/<br\s*\/?>/gi, '\n')));
}
function markdown(text, url) {
  const article = document.createDocumentFragment();
  const lines = text.split(/\r?\n/);
  let code = null, table = null, list = null;
  for (const line of lines) {
    if (line.startsWith(String.fromCharCode(96).repeat(3))) {
      if (code) code = null; else { code = el('pre'); article.append(code); }
      continue;
    }
    if (code) { code.textContent += line + '\n'; continue; }
    if (!line.trim()) { table = null; list = null; continue; }
    if (line.startsWith('|')) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      if (!table) { const wrap = el('div', 'table-wrap'); table = el('table'); wrap.append(table); article.append(wrap); }
      const row = el('tr');
      for (const cell of line.replace(/^\||\|$/g, '').split(/(?<!\\)\|/)) {
        const td = el(table.children.length ? 'td' : 'th'); inlineMarkdown(td, cell.trim(), url); row.append(td);
      }
      table.append(row); continue;
    }
    table = null;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (heading) { const h = el('h' + heading[1].length); inlineMarkdown(h, heading[2], url); article.append(h); list = null; }
    else if (bullet) { if (!list) { list = el('ul'); article.append(list); } const li = el('li'); inlineMarkdown(li, bullet[1], url); list.append(li); }
    else { list = null; const p = el('p'); inlineMarkdown(p, line, url); article.append(p); }
  }
  return article;
}

async function openDocument(doc) {
  state.docName = doc.name;
  $('documentBody').textContent = '正在读取文稿…';
  try {
    const response = await fetch(doc.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('文稿读取失败');
    const text = await response.text();
    if (state.docName !== doc.name) return;
    $('documentBody').replaceChildren(markdown(text, new URL(doc.url, location.origin)));
    document.querySelectorAll('[data-document]').forEach(button => button.classList.toggle('active', button.dataset.document === doc.name));
  } catch (error) { $('documentBody').textContent = error.message; }
}
function renderDocuments() {
  const list = $('documentList');
  list.replaceChildren();
  for (const doc of state.payload.documents) {
    if (/\.(md|txt)$/i.test(doc.name)) {
      const button = el('button', '', doc.name.replace(/\.(md|txt)$/i, ''));
      button.dataset.document = doc.name; list.append(button);
    } else {
      const link = el('a', '', doc.name); link.href = doc.url; link.target = '_blank'; list.append(link);
    }
  }
  const first = state.payload.documents.find(doc => /\.(md|txt)$/i.test(doc.name));
  if (first) openDocument(first);
  else $('documentBody').textContent = '当前章节尚无文稿。';
}

document.addEventListener('click', event => {
  const target = event.target.closest('button,a');
  if (!target) return;
  if (target.dataset.shot) chooseFrame(target.dataset.shot);
  if (target.dataset.frame) { event.preventDefault(); chooseFrame(target.dataset.frame); }
  if (target.dataset.source) { state.source = target.dataset.source; state.mode = 'frame'; state.docs = false; state.zoom = 1; render(); }
  if (target.dataset.mode === 'frame') { state.mode = 'frame'; render(); }
  if (target.dataset.mode === 'page' && state.pages.length) choosePage(current().frame?.sheet_ref || state.pageId || state.pages[0]);
  if (target.dataset.detail) { state.detail = target.dataset.detail; renderDetails(); document.querySelectorAll('[data-detail]').forEach(button => button.classList.toggle('active', button === target)); }
  if (target.dataset.document) openDocument(state.payload.documents.find(doc => doc.name === target.dataset.document));
});
$('chapterSelect').addEventListener('change', event => {
  state.id = event.target.value; history.replaceState(null, '', '/?chapter=' + encodeURIComponent(state.id));
  state.query = ''; $('search').value = ''; loadChapter();
});
$('refresh').addEventListener('click', () => loadChapter(true));
$('previous').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('search').addEventListener('input', event => { state.query = event.target.value; renderList(); });
$('docsButton').addEventListener('click', () => { state.docs = true; render(); renderDocuments(); });
const zoom = delta => { state.zoom = Math.max(.4, Math.min(4, state.zoom + delta)); applyZoom(); };
$('zoomIn').addEventListener('click', () => zoom(.2));
$('zoomOut').addEventListener('click', () => zoom(-.2));
$('fit').addEventListener('click', () => { state.zoom = 1; applyZoom(); });
$('annotations').addEventListener('change', renderImage);
$('fullscreen').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await $('viewer').requestFullscreen();
});
document.addEventListener('keydown', event => {
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey || state.docs) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
  if (event.key === '+' || event.key === '=') zoom(.2);
  if (event.key === '-') zoom(-.2);
});
window.addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (state.pages.includes(id)) choosePage(id); else chooseFrame(id);
});
try { await loadLibrary(); await loadChapter(); } catch (error) { errorMessage(error.message); }
