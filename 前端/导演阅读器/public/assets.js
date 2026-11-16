const $ = id => document.getElementById(id);
let chapter = new URLSearchParams(location.search).get('chapter') || 'example';
let base = '';
let request = 0;

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function mediaURL(ref) {
  if (!ref || typeof ref !== 'string') return '';
  try {
    const url = new URL(ref.replaceAll('\\', '/'), new URL(base, location.origin));
    return url.origin === location.origin && url.pathname.startsWith('/files/') ? url.href : '';
  } catch { return ''; }
}
async function getJSON(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '读取失败');
  return data;
}
function link(text, href) {
  const node = el('a', '', text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener';
  return node;
}
function showImage(url, name) {
  $('previewTitle').textContent = name;
  $('previewImage').src = url;
  $('previewImage').alt = name;
  $('previewOriginal').href = url;
  $('preview').showModal();
}
function imageCard(item, name, mother = false) {
  const card = el('figure', 'asset-card' + (mother ? ' mother' : ''));
  const label = el('figcaption', 'asset-label');
  label.append(el('small', '', mother ? '身份母本' : item?.scene || '本次变装'), el('h3', '', item?.label || '待补齐'));
  card.append(label);
  const url = mediaURL(item?.image_ref);
  if (url) {
    const button = el('button', 'image-button');
    const title = name + ' · ' + item.label;
    button.setAttribute('aria-label', '放大查看' + title);
    const image = el('img'); image.src = url; image.alt = title;
    image.addEventListener('error', () => button.replaceWith(el('p', 'unavailable', '图片无法读取，请检查原件。')));
    button.append(image); button.addEventListener('click', () => showImage(url, title)); card.append(button);
  } else card.append(el('p', 'unavailable', '图片待补齐'));
  const info = el('div', 'asset-info');
  info.append(el('span', 'status', item?.status || '待补齐'));
  if (url) info.append(link('原图 ↗', url));
  if (item?.confirmation) info.append(el('p', '', item.confirmation));
  card.append(info);
  return card;
}
function voiceCard(voice, name) {
  const box = el('div', 'voice');
  const info = el('div', 'voice-info');
  info.append(el('div', 'eyebrow', '角色声线'), el('strong', '', voice?.label || '待补齐'),
    el('p', '', [voice?.status, voice?.confirmation].filter(Boolean).join(' · ')));
  box.append(info);
  const url = mediaURL(voice?.audio_ref);
  if (!url) { box.append(el('p', 'voice-error', '尚无可播放样音')); return box; }
  const audio = el('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = url;
  audio.setAttribute('aria-label', name + '声线样音');
  const play = el('button', 'play', '试听' + name);
  const error = el('span', 'voice-error'); error.hidden = true; error.setAttribute('role', 'alert');
  play.addEventListener('click', async () => {
    if (!audio.paused) { audio.pause(); return; }
    try { await audio.play(); } catch { error.textContent = '样音无法播放，可打开原件检查。'; error.hidden = false; }
  });
  audio.addEventListener('play', () => {
    for (const other of document.querySelectorAll('audio')) if (other !== audio) other.pause();
    play.textContent = '暂停' + name;
  });
  audio.addEventListener('pause', () => { play.textContent = '试听' + name; });
  audio.addEventListener('error', () => { error.textContent = '样音无法读取'; error.hidden = false; });
  box.append(play, audio, link('样音原件 ↗', url), error);
  return box;
}
function render(data) {
  base = data.base;
  const delivery = data.document;
  $('characters').replaceChildren(); $('characterNav').replaceChildren();
  $('readerLink').href = '/?chapter=' + encodeURIComponent(chapter);
  $('workName').textContent = (delivery?.title || chapter.split('/')[0]) + ' / 03';
  $('pageTitle').textContent = (delivery?.chapter || (chapter === 'example' ? '示例' : chapter.split('/').at(-1))) + ' · 角色资产交付';
  document.title = $('pageTitle').textContent;
  $('empty').hidden = !!delivery;
  $('review').hidden = !delivery;
  $('referenceLink').hidden = !mediaURL(delivery?.reference_ref);
  if (delivery?.reference_ref) $('referenceLink').href = mediaURL(delivery.reference_ref);
  $('summary').textContent = '';
  if (!delivery) return;
  const characters = Array.isArray(delivery.characters) ? delivery.characters : [];
  $('summary').textContent = `${characters.length} 位角色 · ${characters.length} 份母本 · ${characters.reduce((n, c) => n + (c.variants?.length || 0), 0)} 套本次造型 · ${characters.filter(c => c.voice?.audio_ref).length} 条声线`;
  const approved = delivery.review?.status === 'approved';
  $('reviewStatus').textContent = approved ? '整套已确认' : '待最终确认';
  $('reviewNote').textContent = approved ? delivery.review.confirmation : '看完后在聊天中确认采用，或注明要改的角色、造型或声线。';
  for (const [index, character] of characters.entries()) {
    const section = el('section', 'character'); section.id = 'character-' + (index + 1);
    const nav = el('a', '', character.name); nav.href = '#' + section.id; $('characterNav').append(nav);
    const heading = el('div', 'character-heading');
    heading.append(el('h2', '', character.name), el('span', '', (character.variants?.length || 0) + ' 套本次造型'));
    const gallery = el('div', 'gallery');
    gallery.append(imageCard(character.mother, character.name, true));
    for (const variant of character.variants || []) gallery.append(imageCard(variant, character.name));
    section.append(heading, gallery, voiceCard(character.voice, character.name));
    $('characters').append(section);
  }
  if (!characters.length) { $('empty').textContent = '本次无角色资产，请查看章节资产引用表。'; $('empty').hidden = false; }
}
async function load() {
  const version = ++request;
  for (const audio of document.querySelectorAll('audio')) audio.pause();
  $('preview').close();
  $('characters').replaceChildren(); $('characterNav').replaceChildren();
  $('error').hidden = true; $('empty').hidden = true; $('review').hidden = true; $('referenceLink').hidden = true;
  $('summary').textContent = '读取中…';
  try {
    const data = await getJSON('/api/assets?id=' + encodeURIComponent(chapter));
    if (version !== request) return;
    render(data);
    if (data.issues.length) {
      $('error').textContent = '交付资料待补齐：\n' + data.issues.map(issue => issue.field + '：' + issue.message).join('\n');
      $('error').hidden = false;
    }
  } catch (error) {
    if (version !== request) return;
    $('summary').textContent = '';
    $('error').textContent = '无法读取资产交付：' + error.message; $('error').hidden = false;
  }
}
$('closePreview').addEventListener('click', () => $('preview').close());
$('preview').addEventListener('click', event => { if (event.target === $('preview')) $('preview').close(); });
$('refresh').addEventListener('click', load);
$('chapterSelect').addEventListener('change', () => {
  chapter = $('chapterSelect').value;
  history.replaceState(null, '', '/assets?chapter=' + encodeURIComponent(chapter));
  load();
});
try {
  const { chapters } = await getJSON('/api/library');
  for (const item of chapters) {
    const option = el('option', '', item.title + ' / ' + item.chapter); option.value = item.id;
    $('chapterSelect').append(option);
  }
  if (!chapters.some(item => item.id === chapter)) {
    const option = el('option', '', chapter); option.value = chapter; $('chapterSelect').append(option);
  }
  $('chapterSelect').value = chapter;
  await load();
} catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
