import { parseCSV, toCSV, renderMarkdown, escHTML as e } from './lib.js';
import { taoStore, docCaiDat, ghiCaiDat, xoaCaiDat, LocalStore, LoiXungDot } from './store.js';

const $app = document.getElementById('app');
const $cheDo = document.getElementById('che-do');
const $toast = document.getElementById('toast');

const TRANG_THAI = ['đang mở', 'tạm dừng', 'đã dừng', 'hoàn thành'];
const LOP_TT = { 'đang mở': 'mo', 'tạm dừng': 'tam', 'đã dừng': 'dung', 'hoàn thành': 'xong' };
const FILE_DM = 'du_lieu/danh_muc_du_an.csv';
const FILE_CS = 'du_lieu/cong_suat.md';
const HO_SO = [
  ['brief.md', 'Brief'], ['cong_chan.md', 'Cổng chặn'], ['chien_luoc.md', 'Chiến lược'],
  ['moc.md', 'Mốc'], ['viec.json', 'Việc'], ['nhat_ky_tuan.md', 'Nhật ký'],
];
const NGAY_RA_SOAT = 10; // khớp /tuan
const GIO_TOI_DA = 8; // khớp scripts/kiem_ke_hoach.py

let store = null;
const st = { dm: null, cs: null };
const ui = { loc: 'đang mở', khaiGio: false, phien: 0 };

// ---------- tiện ích ----------
function homNay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function soNgayTu(ngay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay || '')) return null;
  const [y, m, d] = ngay.split('-').map(Number);
  const n = new Date();
  return Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(y, m - 1, d)) / 86400000);
}
/** null = ô trống; NaN = không phải số. */
function soHoacNull(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const laSoHopLe = (n) => n !== null && !Number.isNaN(n);
const fmt = (n) => (Math.round(n * 100) / 100).toString().replace('.', ',');

let hanToast;
function toast(msg, loai = 'ok') {
  $toast.textContent = msg;
  $toast.className = `show ${loai}`;
  clearTimeout(hanToast);
  hanToast = setTimeout(() => { $toast.className = ''; }, loai === 'loi' ? 7000 : 3000);
}

async function thucHien(nut, fn) {
  const nhan = nut?.textContent;
  if (nut) { nut.disabled = true; nut.textContent = 'Đang lưu…'; }
  try {
    await fn();
  } catch (err) {
    if (err instanceof LoiXungDot) {
      toast('Dữ liệu vừa bị sửa ở nơi khác (máy tính hoặc thiết bị khác). Đã tải bản mới – hãy nhập lại.', 'loi');
      try { await taiDuLieu(); } catch { /* lỗi tải sẽ hiện ở lần sau */ }
      route();
    } else {
      toast(err?.message || String(err), 'loi');
    }
  } finally {
    if (nut?.isConnected) { nut.disabled = false; nut.textContent = nhan; }
  }
}

// ---------- dữ liệu ----------
function docCongSuat(text) {
  const m = text.match(/^[ \t]*gio_moi_tuan_cho_du_an_moi[ \t]*:[ \t]*(.*)$/m);
  return m ? soHoacNull(m[1]) : null;
}

async function taiDuLieu(s = store) {
  const [dm, cs] = await Promise.all([s.getFile(FILE_DM), s.getFile(FILE_CS)]);
  if (!dm) throw new Error(`Không thấy ${FILE_DM} trong kho. Kiểm tên repo và nhánh.`);
  const p = parseCSV(dm.text);
  if (!p.header.includes('ma_du_an')) throw new Error(`${FILE_DM} thiếu cột ma_du_an`);
  st.dm = { header: p.header, rows: p.rows, sha: dm.sha };
  st.cs = cs ? { text: cs.text, sha: cs.sha, value: docCongSuat(cs.text) } : { text: null, sha: null, value: null };
}

async function luuDanhMuc(msg) {
  st.dm.sha = await store.putFile(FILE_DM, toCSV(st.dm.header, st.dm.rows), st.dm.sha, msg);
}

async function luuCongSuat(v) {
  const dong = `gio_moi_tuan_cho_du_an_moi: ${v}`;
  const re = /^[ \t]*gio_moi_tuan_cho_du_an_moi[ \t]*:.*$/m;
  let text = st.cs.text;
  if (text == null) text = `# Công suất cho dự án mới\n\n${dong}\n`;
  else if (re.test(text)) text = text.replace(re, dong);
  else text = text.replace(/\s*$/, `\n\n${dong}\n`);
  const sha = await store.putFile(FILE_CS, text, st.cs.sha, `app: công suất dự án mới ${v} giờ/tuần`);
  st.cs = { text, sha, value: v };
}

// ---------- định tuyến ----------
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  const phien = ++ui.phien;
  window.scrollTo(0, 0);
  if (h === '/cai-dat') return viewCaiDat();
  if (!st.dm) return viewCaiDat();
  let m;
  if ((m = h.match(/^\/du-an\/([^/]+)\/nhat-ky$/))) return viewNhatKy(m[1], phien);
  if ((m = h.match(/^\/du-an\/([^/]+)$/))) return viewDuAn(m[1], phien);
  return viewTongQuan();
}
window.addEventListener('hashchange', route);

const linkDuAn = (ma) => `#/du-an/${encodeURIComponent(ma)}`;

// ---------- màn hình: tổng quan ----------
function theDuAn(r, idx) {
  const n = soNgayTu(r.ngay_cap_nhat);
  const cu = r.trang_thai === 'đang mở' && (n === null || n > NGAY_RA_SOAT);
  const ngay = r.ngay_cap_nhat ? `cập nhật ${e(r.ngay_cap_nhat)}${n !== null ? ` (${n} ngày)` : ''}` : 'chưa rà soát';
  const g = soHoacNull(r.gio_moi_tuan);
  const gio = g === null ? 'chưa khai giờ' : Number.isNaN(g) ? `giờ sai: “${e(r.gio_moi_tuan)}”` : `${fmt(g)} giờ/tuần`;
  const dau = `<div class="card-top"><span class="ten">${e(r.ten_du_an)}</span><span class="badge ${LOP_TT[r.trang_thai] || ''}">${e(r.trang_thai || '?')}</span></div>`;
  if (ui.khaiGio) {
    return `<li class="card"><label class="card-in">${dau}
      <span class="row"><input type="number" inputmode="decimal" min="0" step="0.5" name="gio:${idx}" value="${e(r.gio_moi_tuan)}" placeholder="?" aria-label="Giờ/tuần cho ${e(r.ten_du_an)}"><span class="unit">giờ/tuần</span></span></label></li>`;
  }
  const noi = `${dau}<div class="meta"><span class="${g === null || Number.isNaN(g) ? 'warn-text' : ''}">${gio}</span> · <span class="${cu ? 'warn-text' : ''}">${ngay}</span></div>${r.ket_qua_ky_vong ? `<div class="kq">${e(r.ket_qua_ky_vong)}</div>` : ''}`;
  return `<li class="card">${r.ma_du_an ? `<a class="card-in" href="${linkDuAn(r.ma_du_an)}">${noi}</a>` : `<div class="card-in">${noi}<div class="muted small">Chưa có mã dự án – sửa trong CSV.</div></div>`}</li>`;
}

function viewTongQuan() {
  const rows = st.dm.rows;
  const mo = rows.filter((r) => r.trang_thai === 'đang mở');
  const gioMo = mo.map((r) => soHoacNull(r.gio_moi_tuan));
  const daKhai = gioMo.filter(laSoHopLe);
  const tong = daKhai.reduce((s, g) => s + g, 0);
  const chuaKhai = mo.length - daKhai.length;
  const canRa = mo.filter((r) => { const n = soNgayTu(r.ngay_cap_nhat); return n === null || n > NGAY_RA_SOAT; });
  const cs = st.cs.value;
  const nhom = ['tất cả', ...TRANG_THAI];
  const dem = Object.fromEntries(nhom.map((t) => [t, t === 'tất cả' ? rows.length : rows.filter((r) => r.trang_thai === t).length]));
  const ds = rows.map((r, i) => [r, i]).filter(([r]) => ui.loc === 'tất cả' || r.trang_thai === ui.loc);

  $app.innerHTML = `
  <section class="stats">
    <div class="stat"><div class="stat-num">${mo.length}</div><div class="stat-lbl">dự án đang mở</div></div>
    <div class="stat"><div class="stat-num">${fmt(tong)}<small> giờ/tuần</small></div>
      <div class="stat-lbl">đã khai cho dự án đang mở${chuaKhai ? ` · <span class="warn-text">${chuaKhai} chưa khai</span>` : ''}</div></div>
    <form class="stat" id="f-cs">
      <label class="stat-lbl" for="cs">Công suất cho dự án mới</label>
      <span class="row"><input id="cs" name="cs" type="number" inputmode="decimal" min="0" step="0.5" value="${laSoHopLe(cs) ? cs : ''}" placeholder="?"><span class="unit">giờ/tuần</span><button class="btn small">Lưu</button></span>
    </form>
  </section>
  ${canRa.length ? `<section class="alert"><strong>${canRa.length} dự án cần rà soát</strong> – quá ${NGAY_RA_SOAT} ngày hoặc chưa từng rà. Mở dự án → “Ghi nhật ký tuần”, hoặc chạy <code>/tuan</code> trong Claude Code.</section>` : ''}
  <div class="toolbar">
    <div class="chips">${nhom.map((t) => `<button type="button" class="chip${ui.loc === t ? ' on' : ''}" data-loc="${e(t)}" aria-pressed="${ui.loc === t}">${e(t)} <span>${dem[t]}</span></button>`).join('')}</div>
    <button type="button" class="btn small ${ui.khaiGio ? '' : 'ghost'}" id="b-khai">${ui.khaiGio ? 'Hủy khai giờ' : 'Khai giờ hàng loạt'}</button>
  </div>
  ${ui.khaiGio ? '<p class="muted">Nhập số giờ/tuần bạn <strong>thực sự</strong> dành cho từng dự án (bỏ trống nếu chưa biết), rồi bấm Lưu một lần.</p>' : ''}
  <form id="f-ds">
    <ul class="list">${ds.map(([r, i]) => theDuAn(r, i)).join('') || '<li class="empty">Không có dự án ở nhóm này.</li>'}</ul>
    ${ui.khaiGio ? '<div class="sticky-save"><button class="btn">Lưu giờ</button></div>' : ''}
  </form>`;

  $app.querySelectorAll('[data-loc]').forEach((b) => { b.onclick = () => { ui.loc = b.dataset.loc; viewTongQuan(); }; });
  $app.querySelector('#b-khai').onclick = () => { ui.khaiGio = !ui.khaiGio; viewTongQuan(); };
  $app.querySelector('#f-cs').onsubmit = (ev) => {
    ev.preventDefault();
    thucHien(ev.submitter, async () => {
      const v = soHoacNull(ev.target.cs.value);
      if (!laSoHopLe(v) || v < 0) throw new Error('Công suất phải là số ≥ 0.');
      if (v === st.cs.value) { toast('Không có gì thay đổi'); return; }
      await luuCongSuat(v);
      toast(`Đã lưu công suất ${fmt(v)} giờ/tuần`);
      viewTongQuan();
    });
  };
  $app.querySelector('#f-ds').onsubmit = (ev) => {
    ev.preventDefault();
    if (!ui.khaiGio) return;
    thucHien(ev.submitter, async () => {
      const doi = [];
      for (const [k, v] of new FormData(ev.target)) {
        const i = Number(k.slice(4));
        const s = String(v).trim().replace(',', '.');
        if (s !== '' && !(Number(s) >= 0)) throw new Error(`Giờ không hợp lệ ở “${st.dm.rows[i].ten_du_an}”.`);
        if ((st.dm.rows[i].gio_moi_tuan ?? '') !== s) doi.push([i, s]);
      }
      if (!doi.length) { toast('Không có gì thay đổi'); return; }
      const truoc = doi.map(([i]) => st.dm.rows[i].gio_moi_tuan);
      doi.forEach(([i, s]) => { st.dm.rows[i].gio_moi_tuan = s; });
      try {
        await luuDanhMuc(`app: khai giờ/tuần cho ${doi.length} dự án`);
      } catch (err) {
        doi.forEach(([i], k) => { st.dm.rows[i].gio_moi_tuan = truoc[k]; });
        throw err;
      }
      ui.khaiGio = false;
      toast(`Đã lưu giờ cho ${doi.length} dự án`);
      viewTongQuan();
    });
  };
}

// ---------- màn hình: một dự án ----------
function renderViec(text) {
  let ds;
  try { ds = JSON.parse(text.replace(/^﻿/, '')); } catch (err) { return `<p class="error">viec.json không phải JSON hợp lệ: ${e(err.message)}</p>`; }
  if (!Array.isArray(ds)) return '<p class="error">viec.json phải là một danh sách.</p>';
  const gio = (ng) => ds.filter((v) => v?.nguoi_lam === ng).reduce((s, v) => s + (typeof v.gio_uoc === 'number' ? v.gio_uoc : 0), 0);
  const tongToi = gio('tôi');
  const cs = st.cs.value;
  const tran = laSoHopLe(cs) ? cs * 2 : null;
  const vuot = tran !== null && tongToi > tran;
  const items = ds.map((v) => {
    const canh = [];
    if (!v || typeof v !== 'object') return '<li class="error">Việc không hợp lệ</li>';
    if (!String(v.dau_ra_kiem_duoc ?? '').trim()) canh.push('thiếu đầu ra kiểm được');
    if (typeof v.gio_uoc === 'number' && v.gio_uoc > GIO_TOI_DA) canh.push(`quá ${GIO_TOI_DA} giờ`);
    const pt = Array.isArray(v.phu_thuoc) && v.phu_thuoc.length ? `<div class="meta">Phụ thuộc: ${v.phu_thuoc.map((x) => e(x)).join(', ')}</div>` : '';
    return `<li class="card"><div class="card-in">
      <div class="card-top"><span><code>${e(v.ma_viec ?? '?')}</code> ${e(v.ten_viec ?? '')}</span><span class="badge">${e(v.nguoi_lam ?? '?')} · ${e(v.gio_uoc ?? '?')}h</span></div>
      <div class="meta">Đầu ra: ${e(v.dau_ra_kiem_duoc ?? '')}</div>${pt}${canh.length ? `<div class="error small">⚠ ${canh.join('; ')}</div>` : ''}</div></li>`;
  });
  return `<p class="${vuot ? 'error' : 'muted'}">${ds.length} việc · giờ của bạn <strong>${fmt(tongToi)}</strong>${tran !== null ? ` / trần 2 tuần ${fmt(tran)}` : ' (chưa có công suất)'} · giờ AI ${fmt(gio('AI'))}</p>
    <ul class="list">${items.join('')}</ul>
    <p class="muted small">Đây chỉ là kiểm nhanh để xem. Cổng kiểm chính thức: <code>python scripts/kiem_ke_hoach.py du_an/&lt;ma&gt;</code>.</p>`;
}

async function viewDuAn(ma, phien) {
  const r = st.dm.rows.find((x) => x.ma_du_an === ma);
  if (!r) { $app.innerHTML = `<p>Không có dự án mã <code>${e(ma)}</code>.</p><p><a href="#/">← Về danh sách</a></p>`; return; }
  const ttLa = TRANG_THAI.includes(r.trang_thai) ? '' : `<option selected>${e(r.trang_thai)}</option>`;
  $app.innerHTML = `
  <a href="#/" class="back">← Danh sách</a>
  <h1>${e(r.ten_du_an)}</h1>
  <p class="muted">Mã <code>${e(r.ma_du_an)}</code></p>
  <form id="f-da" class="panel">
    <label>Trạng thái<select name="trang_thai">${TRANG_THAI.map((t) => `<option${t === r.trang_thai ? ' selected' : ''}>${e(t)}</option>`).join('')}${ttLa}</select></label>
    <label>Giờ/tuần bạn dành cho dự án<input name="gio_moi_tuan" type="number" inputmode="decimal" min="0" step="0.5" value="${e(r.gio_moi_tuan)}" placeholder="chưa khai"></label>
    <label>Kết quả kỳ vọng trong 90 ngày (đo bằng số)<textarea name="ket_qua_ky_vong" rows="2" placeholder="vd: 10 khách trả tiền, 20 triệu/tháng">${e(r.ket_qua_ky_vong)}</textarea></label>
    <label>Ngày cập nhật<span class="row"><input name="ngay_cap_nhat" type="date" value="${e(r.ngay_cap_nhat)}"><button type="button" class="btn ghost small" id="b-hom-nay">Hôm nay</button></span></label>
    <div class="actions"><button class="btn">Lưu</button><a class="btn ghost" href="${linkDuAn(ma)}/nhat-ky">Ghi nhật ký tuần</a></div>
  </form>
  <section id="ho-so" class="panel"><h2>Hồ sơ dự án</h2><p class="muted">Đang tải…</p></section>`;

  const f = $app.querySelector('#f-da');
  $app.querySelector('#b-hom-nay').onclick = () => { f.ngay_cap_nhat.value = homNay(); };
  f.onsubmit = (ev) => {
    ev.preventDefault();
    thucHien(ev.submitter, async () => {
      const moi = {
        trang_thai: f.trang_thai.value,
        gio_moi_tuan: f.gio_moi_tuan.value.trim().replace(',', '.'),
        ket_qua_ky_vong: f.ket_qua_ky_vong.value.trim(),
        ngay_cap_nhat: f.ngay_cap_nhat.value,
      };
      if (moi.gio_moi_tuan !== '' && !(Number(moi.gio_moi_tuan) >= 0)) throw new Error('Giờ/tuần phải là số ≥ 0.');
      const doi = Object.keys(moi).filter((k) => (r[k] ?? '') !== moi[k]);
      if (!doi.length) { toast('Không có gì thay đổi'); return; }
      if (moi.trang_thai === 'đã dừng' && r.trang_thai !== 'đã dừng' && !confirm(`Chuyển “${r.ten_du_an}” sang ĐÃ DỪNG?`)) return;
      const truoc = { ...r };
      Object.assign(r, moi);
      try {
        await luuDanhMuc(`app: cập nhật ${ma} (${doi.join(', ')})`);
      } catch (err) {
        Object.assign(r, truoc);
        throw err;
      }
      toast('Đã lưu');
    });
  };

  const $hs = $app.querySelector('#ho-so');
  let ds;
  try {
    ds = await store.listDir(`du_an/${ma}`);
  } catch (err) {
    if (phien === ui.phien) $hs.innerHTML = `<h2>Hồ sơ dự án</h2><p class="error">${e(err.message)}</p>`;
    return;
  }
  if (phien !== ui.phien) return;
  const coFile = HO_SO.filter(([fn]) => ds.some((x) => x.name === fn && x.type === 'file'));
  if (!coFile.length) {
    $hs.innerHTML = '<h2>Hồ sơ dự án</h2><p class="muted">Chưa có hồ sơ. Lập kế hoạch bằng lệnh <code>/y-tuong</code> trong Claude Code; brief, cổng chặn, chiến lược, mốc và việc sẽ hiện ở đây.</p>';
    return;
  }
  $hs.innerHTML = `<h2>Hồ sơ dự án</h2>
    <div class="tabs" role="tablist">${coFile.map(([fn, t], k) => `<button type="button" role="tab" class="tab${k === 0 ? ' on' : ''}" data-f="${fn}" aria-selected="${k === 0}">${t}</button>`).join('')}</div>
    <div id="hs-nd" class="md"></div>`;
  const $nd = $hs.querySelector('#hs-nd');
  const daTai = new Map();
  let dangMo = '';
  const mo = async (fn) => {
    dangMo = fn;
    $hs.querySelectorAll('.tab').forEach((b) => { const on = b.dataset.f === fn; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $nd.innerHTML = '<p class="muted">Đang tải…</p>';
    try {
      const file = daTai.get(fn) ?? (await store.getFile(`du_an/${ma}/${fn}`));
      daTai.set(fn, file);
      if (phien !== ui.phien || dangMo !== fn) return;
      $nd.innerHTML = !file ? '<p class="muted">File trống.</p>' : fn.endsWith('.json') ? renderViec(file.text) : renderMarkdown(file.text);
    } catch (err) {
      if (dangMo === fn) $nd.innerHTML = `<p class="error">${e(err.message)}</p>`;
    }
  };
  $hs.querySelectorAll('.tab').forEach((b) => { b.onclick = () => mo(b.dataset.f); });
  mo(coFile[0][0]);
}

// ---------- màn hình: nhật ký tuần ----------
function taoMucNhatKy(ngay, dong, kqTuan, ghiChu) {
  const o = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
  const so = (n) => (n === null || n === undefined ? '' : String(Math.round(n * 100) / 100));
  const L = [`## Tuần kết thúc ${ngay}`, '', '_Ghi từ app._', '',
    '| ma_viec | gio_uoc | gio_that | he_so_lech | ket_qua_do_duoc |', '|---|---|---|---|---|'];
  for (const d of dong) L.push(`| ${o(d.ma)} | ${so(d.uoc)} | ${so(d.that)} | ${d.uoc ? so(d.that / d.uoc) : ''} | ${o(d.kq)} |`);
  const coUoc = dong.filter((d) => d.uoc);
  const tu = coUoc.reduce((s, d) => s + d.that, 0);
  const mau = coUoc.reduce((s, d) => s + d.uoc, 0);
  L.push('', `- Tổng giờ thật: ${so(dong.reduce((s, d) => s + d.that, 0))}`);
  L.push(`- Hệ số lệch tổng (chỉ việc có giờ ước): ${mau ? so(tu / mau) : 'không tính được – chưa có giờ ước'}`);
  if (kqTuan) L.push(`- Kết quả đo được của tuần: ${o(kqTuan)}`);
  if (ghiChu) L.push(`- Ghi chú: ${o(ghiChu)}`);
  L.push('- Đề xuất: chưa có – chạy `/tuan` trong Claude Code để so với ngưỡng go/no-go.', '');
  return L.join('\n');
}

async function viewNhatKy(ma, phien) {
  const r = st.dm.rows.find((x) => x.ma_du_an === ma);
  if (!r) { $app.innerHTML = `<p>Không có dự án mã <code>${e(ma)}</code>.</p><p><a href="#/">← Về danh sách</a></p>`; return; }
  const dau = `<a href="${linkDuAn(ma)}" class="back">← ${e(r.ten_du_an)}</a><h1>Nhật ký tuần</h1>`;
  $app.innerHTML = `${dau}<p class="muted">Đang tải danh sách việc…</p>`;
  let viec = [];
  try {
    const f = await store.getFile(`du_an/${ma}/viec.json`);
    if (f) { const j = JSON.parse(f.text.replace(/^﻿/, '')); if (Array.isArray(j)) viec = j.filter((v) => v && typeof v === 'object'); }
  } catch { /* không có hoặc hỏng viec.json: dùng dòng tự do */ }
  if (phien !== ui.phien) return;

  const oGio = (name) => `<label>Giờ thật<input type="number" inputmode="decimal" min="0" step="0.25" name="${name}" placeholder="bỏ trống nếu chưa làm"></label>`;
  const dongViec = viec.map((v, k) => `<li class="card"><div class="card-in">
      <div class="card-top"><span><code>${e(v.ma_viec)}</code> ${e(v.ten_viec)}</span><span class="muted small">ước ${e(v.gio_uoc)}h</span></div>
      <div class="row2">${oGio(`that:${k}`)}<label>Kết quả đo được<input name="kq:${k}" placeholder="vd: 12/20 khách trả lời"></label></div></div></li>`).join('');
  const dongTuDo = [0, 1, 2].map((k) => `<li class="card"><div class="card-in">
      <label>Việc đã làm<input name="tu_ten:${k}" placeholder="tên việc"></label>
      <div class="row2">${oGio(`tu_that:${k}`)}<label>Kết quả đo được<input name="tu_kq:${k}"></label></div></div></li>`).join('');

  $app.innerHTML = `${dau}
  <form id="f-nk">
    ${viec.length ? `<h2>Việc trong kế hoạch</h2><ul class="list">${dongViec}</ul>` : ''}
    <h2>${viec.length ? 'Việc ngoài kế hoạch' : 'Việc đã làm tuần này'}</h2>
    <ul class="list">${dongTuDo}</ul>
    <div class="panel">
      <label>Kết quả đo được của cả tuần (con số, không phải cảm nhận)<textarea name="kq_tuan" rows="3"></textarea></label>
      <label>Ghi chú<textarea name="ghi_chu" rows="2"></textarea></label>
    </div>
    <p class="muted small">Lưu sẽ thêm một mục vào <code>du_an/${e(ma)}/nhat_ky_tuan.md</code> và đặt ngày cập nhật của dự án là hôm nay. So với ngưỡng go/no-go và đề xuất tiếp tục / sửa / dừng do <code>/tuan</code> trong Claude Code làm.</p>
    <div class="sticky-save"><button class="btn">Lưu nhật ký</button></div>
  </form>`;

  const f = $app.querySelector('#f-nk');
  f.onsubmit = (ev) => {
    ev.preventDefault();
    thucHien(ev.submitter, async () => {
      const fd = new FormData(f);
      const lay = (k) => String(fd.get(k) ?? '').trim();
      const gio = (k, ten) => {
        const n = soHoacNull(lay(k));
        if (Number.isNaN(n) || (n !== null && n < 0)) throw new Error(`Giờ thật không hợp lệ ở “${ten}”.`);
        return n;
      };
      const dong = [];
      viec.forEach((v, k) => {
        const that = gio(`that:${k}`, v.ten_viec);
        if (that !== null) dong.push({ ma: v.ma_viec, uoc: typeof v.gio_uoc === 'number' ? v.gio_uoc : null, that, kq: lay(`kq:${k}`) });
      });
      [0, 1, 2].forEach((k) => {
        const ten = lay(`tu_ten:${k}`);
        const that = gio(`tu_that:${k}`, ten || `dòng ${k + 1}`);
        if (!ten && that === null) return;
        if (!ten) throw new Error(`Dòng tự do ${k + 1}: thiếu tên việc.`);
        if (that === null) throw new Error(`“${ten}”: thiếu giờ thật.`);
        dong.push({ ma: `(ngoài kế hoạch) ${ten}`, uoc: null, that, kq: lay(`tu_kq:${k}`) });
      });
      const kqTuan = lay('kq_tuan');
      if (!dong.length && !kqTuan) throw new Error('Chưa nhập giờ hay kết quả nào.');

      const ngay = homNay();
      const duongDan = `du_an/${ma}/nhat_ky_tuan.md`;
      const cu = await store.getFile(duongDan);
      const nen = cu?.text ?? `# Nhật ký tuần – ${r.ten_du_an}\n`;
      const moi = `${nen.replace(/\s*$/, '')}\n\n${taoMucNhatKy(ngay, dong, kqTuan, lay('ghi_chu'))}`;
      await store.putFile(duongDan, moi, cu?.sha ?? null, `app: nhật ký tuần ${ma} ${ngay}`);

      const truoc = r.ngay_cap_nhat;
      r.ngay_cap_nhat = ngay;
      try {
        await luuDanhMuc(`app: rà soát ${ma} ${ngay}`);
      } catch (err) {
        r.ngay_cap_nhat = truoc;
        throw new Error(`Đã lưu nhật ký, nhưng chưa cập nhật được ngày trong danh mục: ${err.message}`);
      }
      toast('Đã lưu nhật ký tuần');
      location.hash = linkDuAn(ma);
    });
  };
}

// ---------- màn hình: kết nối dữ liệu ----------
function viewCaiDat() {
  const chuPages = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
  const cd = docCaiDat() || { mode: store instanceof LocalStore ? 'local' : 'github', owner: chuPages, branch: 'main' };
  const gh = cd.mode !== 'local';
  $app.innerHTML = `
  ${st.dm ? '<a href="#/" class="back">← Danh sách</a>' : ''}
  <h1>Kết nối dữ liệu</h1>
  ${st.dm ? '' : '<p class="muted">App đọc và ghi thẳng các file trong repo dữ liệu của bạn (danh mục, công suất, hồ sơ dự án). Không có máy chủ trung gian.</p>'}
  <form id="f-cd" class="panel">
    <fieldset class="seg"><legend>Nơi lưu dữ liệu</legend>
      <label class="radio"><input type="radio" name="mode" value="github"${gh ? ' checked' : ''}> GitHub – dùng được mọi nơi</label>
      <label class="radio"><input type="radio" name="mode" value="local"${gh ? '' : ' checked'}> Máy local – đang chạy <code>scripts/chay_app.py</code></label>
    </fieldset>
    <div id="gh"${gh ? '' : ' hidden'}>
      <label>Tài khoản GitHub (chủ repo)<input name="owner" autocomplete="off" autocapitalize="off" spellcheck="false" value="${e(cd.owner || '')}"></label>
      <label>Tên repo dữ liệu<input name="repo" autocomplete="off" autocapitalize="off" spellcheck="false" value="${e(cd.repo || 'ke-hoach-agent')}"></label>
      <label>Nhánh<input name="branch" autocomplete="off" autocapitalize="off" spellcheck="false" value="${e(cd.branch || 'main')}"></label>
      <label>Token GitHub (fine-grained)<input name="token" type="password" autocomplete="off" value="${e(cd.token || '')}" placeholder="github_pat_…"></label>
      <details class="help"><summary>Cách tạo token (1 phút)</summary><ol>
        <li>Mở <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>.</li>
        <li><em>Repository access</em> → <em>Only select repositories</em> → chọn đúng repo dữ liệu.</li>
        <li><em>Permissions → Repository permissions → Contents</em>: <strong>Read and write</strong>. Không cấp quyền nào khác.</li>
        <li>Tạo, sao chép và dán vào ô trên. Token chỉ lưu trong trình duyệt của thiết bị này; mất máy thì thu hồi token trên GitHub.</li>
      </ol></details>
    </div>
    <div class="actions"><button class="btn">Lưu và kết nối</button>${cd.token ? '<button type="button" class="btn ghost" id="b-xoa">Xóa token khỏi máy này</button>' : ''}</div>
  </form>`;

  const f = $app.querySelector('#f-cd');
  f.querySelectorAll('input[name=mode]').forEach((x) => { x.onchange = () => { $app.querySelector('#gh').hidden = f.mode.value === 'local'; }; });
  const xoa = $app.querySelector('#b-xoa');
  if (xoa) xoa.onclick = () => {
    if (!confirm('Xóa token và cài đặt khỏi thiết bị này?')) return;
    xoaCaiDat(); store = null; st.dm = null; capNhatCheDo(); toast('Đã xóa token khỏi thiết bị này'); viewCaiDat();
  };
  f.onsubmit = (ev) => {
    ev.preventDefault();
    thucHien(ev.submitter, async () => {
      const moi = f.mode.value === 'local'
        ? { mode: 'local' }
        : { mode: 'github', owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main', token: f.token.value.trim() };
      if (moi.mode === 'github' && !(moi.owner && moi.repo && moi.token)) throw new Error('Cần đủ tài khoản, tên repo và token.');
      const s = taoStore(moi);
      const thongBao = await s.kiemKetNoi();
      await taiDuLieu(s);
      store = s;
      if (!ghiCaiDat(moi)) toast('Trình duyệt không cho lưu cài đặt – lần sau phải nhập lại.', 'loi');
      else toast(thongBao);
      capNhatCheDo();
      if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/';
    });
  };
}

// ---------- khởi động ----------
function capNhatCheDo() { $cheDo.textContent = store?.nhan || 'chưa kết nối'; }

document.getElementById('b-tai-lai').onclick = (ev) => {
  if (!store) { location.hash = '#/cai-dat'; return; }
  thucHien(ev.currentTarget, async () => { await taiDuLieu(); route(); toast('Đã tải dữ liệu mới nhất'); });
};

async function khoiDong() {
  let cd = docCaiDat();
  if (!cd && (await LocalStore.coSan())) cd = { mode: 'local' };
  if (cd && (cd.mode === 'local' || (cd.owner && cd.repo && cd.token))) {
    const s = taoStore(cd);
    try {
      await taiDuLieu(s);
      store = s;
    } catch (err) {
      capNhatCheDo();
      viewCaiDat();
      toast(`Không tải được dữ liệu: ${err.message}`, 'loi');
      return;
    }
  }
  capNhatCheDo();
  route();
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* không bắt buộc */ });
}
khoiDong();
