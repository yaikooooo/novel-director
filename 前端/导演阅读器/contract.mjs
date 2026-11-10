// Shared by the server and the production check command.
export const READER_VERSION = 2;
export const DATA_FILE = '05_拍摄设计.json';

export function observedStatus(frame) {
  return frame.observation?.status || frame.status || 'required_not_generated';
}

export function designFrames(document) {
  const design = document?.design;
  if (!design) return [];
  return (design.shot_order || []).flatMap(id => {
    const shot = design.shots?.[id];
    if (!shot) return [];
    if (shot.kind === 'black') {
      return [{ id, shot_id: id, is_black: true, representative_frame: shot.frame_range[0],
        display_frame_range: shot.frame_range }];
    }
    return (shot.design_frames || []).map(frame => ({ ...frame, shot_id: id }));
  });
}

export function frameCounts(document) {
  const frames = designFrames(document).filter(frame => !frame.is_black);
  const counts = { planned: frames.length, generated: 0, adopted: 0, needs_revision: 0, blocked: 0, pending: 0 };
  for (const frame of frames) {
    if (frame.sheet_ref) counts.generated++;
    const status = observedStatus(frame);
    if (['adopted', 'accepted', 'pass', 'approved'].includes(status)) counts.adopted++;
    else if (['needs_revision', 'needs_fix'].includes(status)) counts.needs_revision++;
    else if (status === 'blocked') counts.blocked++;
    else counts.pending++;
  }
  return counts;
}

export function validateDesign(document) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const range = value => Array.isArray(value) && value.length === 2 &&
    value.every(Number.isInteger) && value[0] >= 1 && value[1] >= value[0];
  const rect = value => Array.isArray(value) && value.length === 4 &&
    value.every(Number.isFinite) && value[0] >= 0 && value[1] >= 0 && value[2] > 0 && value[3] > 0;
  if (document?.schema_version !== 4) add('schema_version', '当前分镜与运镜提示词使用 schema_version 4。');
  for (const key of ['data_revision', 'design_revision']) {
    if (!Number.isInteger(document?.[key]) || document[key] < 1) add(key, '须为从1开始的整数。');
  }
  if (!['working', 'review_ready', 'approved'].includes(document?.design_status)) add('design_status', '须填写设计审定状态。');
  const design = document?.design;
  if (!design || typeof design !== 'object') return [...errors, { field: 'design', message: '缺少设计内容。' }];
  const project = design.project || {};
  if (!project.title || !project.chapter) add('design.project', '须填写作品名和章节名。');
  const fps = project.fps?.num / project.fps?.den;
  if (!Number.isFinite(fps) || fps <= 0) add('design.project.fps', '帧率须为有效正数分数。');
  if (!range(project.frame_range)) add('design.project.frame_range', '须填写全局帧范围，首末均计入。');
  const order = design.shot_order;
  if (!Array.isArray(order) || !order.length) return [...errors, { field: 'design.shot_order', message: '须至少有一个镜头。' }];
  const ids = new Set();
  const framesById = new Map();
  let previousEnd = project.frame_range?.[0] - 1;
  for (const id of order) {
    const shot = design.shots?.[id];
    const base = 'design.shots.' + id;
    if (ids.has(id)) add('design.shot_order', '镜号重复 ' + id);
    ids.add(id);
    if (!shot) { add(base, '顺序引用的镜头不存在。'); continue; }
    if (!['camera', 'black'].includes(shot.kind)) add(base + '.kind', '填写 camera 或 black。');
    if (!range(shot.frame_range)) { add(base + '.frame_range', '镜头帧段无效。'); continue; }
    const [start, end] = shot.frame_range;
    const overlap = shot.edit?.overlap_frames || 0;
    if (start !== previousEnd + 1 - overlap) add(base + '.frame_range', '切点存在未声明的缺口或重叠。');
    previousEnd = end;
    if ((end - start + 1) / fps > 3.00001) add(base + '.frame_range', '本段时长超过3秒。');
    if (!design.shot_groups?.[shot.group_ref]) add(base + '.group_ref', '镜组引用不存在。');
    if (shot.kind === 'camera' && !design.scenes?.[shot.scene_ref]) add(base + '.scene_ref', '场景引用不存在。');
    if (shot.kind === 'camera' && !shot.design_frames?.length) add(base + '.design_frames', '摄影镜头须有关键画面需求。');
    if (shot.kind === 'camera' && shot.design_frames?.length > 1) add(base + '.design_frames', '新版制作约定每镜一幅代表图，动作阶段使用箭头和文字表达。');
    let frameEnd = start - 1;
    for (const frame of shot.design_frames || []) {
      const fb = base + '.design_frames.' + frame.id;
      if (!frame.id || framesById.has(frame.id)) add(fb, '图号为空或重复。');
      framesById.set(frame.id, frame);
      for (const annotation of frame.annotations || []) {
        if (!['action', 'camera', 'note'].includes(annotation.kind) || !annotation.label) add(fb + '.annotations', '标注须有 action/camera/note 类别及短说明。');
        const points = [...(annotation.points || []), ...(annotation.label_at ? [annotation.label_at] : [])];
        if (points.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value) || value < 0 || value > 1))) add(fb + '.annotations', '标注位置使用相对当前画格的0—1坐标。');
      }
      if (!range(frame.display_frame_range)) { add(fb, '缺少有效显示帧段。'); continue; }
      const [first, last] = frame.display_frame_range;
      if (first !== frameEnd + 1 || first < start || last > end) add(fb, '关键画面显示帧段须按顺序覆盖本镜。');
      frameEnd = last;
      if (!Number.isInteger(frame.representative_frame) || frame.representative_frame < first || frame.representative_frame > last) add(fb, '代表帧须位于本幅显示帧段内。');
      if (frame.sheet_ref) {
        const sheet = design.board_sheets?.[frame.sheet_ref];
        if (!sheet) { add(fb + '.sheet_ref', '原页引用不存在。'); continue; }
        if (!rect(frame.panel_region)) { add(fb + '.panel_region', '须为实际像素 [x,y,width,height]。'); continue; }
        const [x, y, w, h] = frame.panel_region;
        if (x + w > sheet.width_px || y + h > sheet.height_px) add(fb, '画格超出原页。');
        if (!sheet.frame_ids?.includes(frame.id)) add(fb, '原页 frame_ids 未登记本幅。');
        if (frame.raw_panel_region) {
          if (!rect(frame.raw_panel_region)) add(fb, '原格框坐标无效。');
          else {
            const [rx, ry, rw, rh] = frame.raw_panel_region;
            if (x < rx || y < ry || x + w > rx + rw || y + h > ry + rh) add(fb, '摄影视口超出原格框。');
          }
        }
      }
    }
    if (shot.design_frames?.length && frameEnd !== end) add(base + '.design_frames', '关键画面未覆盖到本镜末帧。');
    for (const cue of shot.sound_cues || []) {
      const source = design.sound_timeline?.[cue.cue_ref];
      if (!source) { add(base + '.sound_cues', '声音引用不存在 ' + cue.cue_ref); continue; }
      if (!range(cue.active_frame_range) || cue.active_frame_range[0] < start || cue.active_frame_range[1] > end) add(base + '.sound_cues', '声音在本镜的区间超出镜头。');
      if (range(source.frame_range) && range(cue.active_frame_range) &&
        (cue.active_frame_range[0] < source.frame_range[0] || cue.active_frame_range[1] > source.frame_range[1])) add(base + '.sound_cues', '声音区间超出声源时间线。');
    }
  }
  if (previousEnd !== project.frame_range?.[1]) add('design.project.frame_range', '末镜与项目末帧不一致。');
  for (const [id, group] of Object.entries(design.shot_groups || {})) {
    for (const shotId of group.shot_ids || []) {
      if (!ids.has(shotId) || design.shots[shotId]?.group_ref !== id) add('design.shot_groups.' + id, '镜组与镜头关联不一致 ' + shotId);
    }
  }
  for (const [id, sheet] of Object.entries(design.board_sheets || {})) {
    if (!sheet.image_ref || !Number.isFinite(sheet.width_px) || !Number.isFinite(sheet.height_px)) add('design.board_sheets.' + id, '原页须有路径及实际像素尺寸。');
    for (const fid of sheet.frame_ids || []) {
      if (framesById.get(fid)?.sheet_ref !== id) add('design.board_sheets.' + id, '原页引用了未绑定的画格 ' + fid);
    }
  }
  return errors;
}

export function validateMotion(document) {
  const motion = document?.motion_design;
  if (!motion) return [];
  const issues = [];
  const add = (field, message) => issues.push({ field: 'motion_design.' + field, message });
  if (motion.source_design_revision !== document.design_revision) {
    add('source_design_revision', '运镜提示词与当前分镜设计版本不同，需同步。');
  }
  if (!['working', 'review_ready', 'approved'].includes(motion.status)) add('status', '填写 working、review_ready 或 approved。');
  if (!motion.shots || typeof motion.shots !== 'object' || Array.isArray(motion.shots)) {
    add('shots', '逐镜提示词须以镜号为键。');
    return issues;
  }
  for (const [id, item] of Object.entries(motion.shots)) {
    const shot = document.design?.shots?.[id];
    if (!shot || shot.kind !== 'camera') { add('shots.' + id, '提示词须引用有效摄影镜头。'); continue; }
    const frame = shot.design_frames?.[0];
    if (!item || typeof item !== 'object' || item.frame_id !== frame?.id) {
      add('shots.' + id + '.frame_id', '提示词须对应本镜唯一代表图。');
    }
    if (!frame?.sheet_ref) add('shots.' + id, '运镜提示词所依据的正式分镜尚未生成。');
    for (const key of ['intent', 'prompt']) {
      if (typeof item?.[key] !== 'string' || !item[key].trim()) add('shots.' + id + '.' + key, '须填写导演意图与完整提示词。');
    }
  }
  if (['review_ready', 'approved'].includes(motion.status)) {
    const scope = motion.shot_ids || (document.design?.shot_order || []).filter(id => document.design.shots[id]?.kind === 'camera');
    if (!Array.isArray(scope) || !scope.length) add('shot_ids', '交付范围须包含摄影镜头。');
    else for (const id of scope) {
      if (document.design?.shots?.[id]?.kind !== 'camera' || !motion.shots[id]) add('shots.' + id, '已交付范围缺少有效运镜提示词。');
    }
  }
  return issues;
}
