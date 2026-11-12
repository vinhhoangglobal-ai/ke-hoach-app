// Kho dữ liệu: GitHub (dùng mọi nơi) hoặc máy chủ local (scripts/chay_app.py).
// Cả hai cùng giao diện: getFile, listDir, putFile, kiemKetNoi.

export class LoiXungDot extends Error {}

const KHOA_CAI_DAT = 'khkh.cai_dat';

export function docCaiDat() {
  try { return JSON.parse(localStorage.getItem(KHOA_CAI_DAT) || 'null'); } catch { return null; }
}
export function ghiCaiDat(cd) {
  try { localStorage.setItem(KHOA_CAI_DAT, JSON.stringify(cd)); return true; } catch { return false; }
}
export function xoaCaiDat() {
  try { localStorage.removeItem(KHOA_CAI_DAT); } catch { /* bỏ qua */ }
}

const dec = new TextDecoder();
const enc = new TextEncoder();
function b64ToText(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return dec.decode(u);
}
function textToB64(t) {
  const u = enc.encode(t);
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(bin);
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function loiGitHub(r, doiTuong) {
  let msg = '';
  try { msg = (await r.json()).message || ''; } catch { /* bỏ qua */ }
  if (r.status === 401) return new Error('Token GitHub không hợp lệ hoặc đã hết hạn (401).');
  if (r.status === 403) return new Error(`GitHub từ chối (403): ${msg}. Kiểm quyền "Contents: Read and write" của token.`);
  if (r.status === 404) return new Error(`Không tìm thấy ${doiTuong} (404). Kiểm tên tài khoản, tên repo, nhánh và phạm vi token.`);
  return new Error(`GitHub lỗi ${r.status}: ${msg}`);
}

export class GitHubStore {
  constructor({ owner, repo, branch, token }) {
    this.o = String(owner).trim();
    this.r = String(repo).trim();
    this.b = String(branch || 'main').trim();
    this.t = String(token).trim();
    this.nhan = `GitHub · ${this.r}`;
  }
  req(p, opts = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${this.t}`,
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const url = `https://api.github.com/repos/${encodeURIComponent(this.o)}/${encodeURIComponent(this.r)}${p}`;
    return fetch(url, { ...opts, headers, cache: 'no-store' });
  }
  async kiemKetNoi() {
    const r = await this.req('');
    if (!r.ok) throw await loiGitHub(r, `repo ${this.o}/${this.r}`);
    const j = await r.json();
    return `Đã kết nối ${j.full_name}${j.private ? '' : ' – CẢNH BÁO: repo đang CÔNG KHAI'}`;
  }
  async getFile(p) {
    const r = await this.req(`/contents/${encPath(p)}?ref=${encodeURIComponent(this.b)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw await loiGitHub(r, p);
    const j = await r.json();
    if (Array.isArray(j)) throw new Error(`${p} là thư mục, không phải file`);
    if (j.encoding !== 'base64') throw new Error(`${p} quá lớn để đọc qua app`);
    return { text: b64ToText(j.content), sha: j.sha };
  }
  async listDir(p) {
    const r = await this.req(`/contents/${encPath(p)}?ref=${encodeURIComponent(this.b)}`);
    if (r.status === 404) return [];
    if (!r.ok) throw await loiGitHub(r, p);
    const j = await r.json();
    return Array.isArray(j) ? j.map((x) => ({ name: x.name, type: x.type === 'dir' ? 'dir' : 'file' })) : [];
  }
  async putFile(p, text, sha, message) {
    const body = { message, content: textToB64(text), branch: this.b };
    if (sha) body.sha = sha;
    const r = await this.req(`/contents/${encPath(p)}`, { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 409) throw new LoiXungDot(`${p} vừa bị sửa ở nơi khác`);
    if (r.status === 422) {
      const msg = (await r.json().catch(() => ({}))).message || '';
      if (/sha/i.test(msg)) throw new LoiXungDot(`${p} vừa bị sửa ở nơi khác`);
      throw new Error(`GitHub từ chối ghi ${p}: ${msg}`);
    }
    if (!r.ok) throw await loiGitHub(r, p);
    return (await r.json()).content.sha;
  }
}

export class LocalStore {
  constructor() {
    this.nhan = 'Máy local';
  }
  static async coSan() {
    try {
      const r = await fetch('api/ping', { cache: 'no-store' });
      return r.ok && (await r.json()).ok === true;
    } catch {
      return false;
    }
  }
  async kiemKetNoi() {
    if (!(await LocalStore.coSan())) throw new Error('Không thấy máy chủ local. Chạy: python scripts/chay_app.py');
    return 'Đã kết nối máy chủ local';
  }
  async getFile(p) {
    const r = await fetch(`api/file?path=${encodeURIComponent(p)}`, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Máy chủ local lỗi ${r.status}: ${await r.text()}`);
    return r.json();
  }
  async listDir(p) {
    const r = await fetch(`api/list?path=${encodeURIComponent(p)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Máy chủ local lỗi ${r.status}: ${await r.text()}`);
    return r.json();
  }
  async putFile(p, text, sha) {
    const r = await fetch('api/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p, text, sha }),
    });
    if (r.status === 409) throw new LoiXungDot(`${p} vừa bị sửa ở nơi khác`);
    if (!r.ok) throw new Error(`Máy chủ local lỗi ${r.status}: ${await r.text()}`);
    return (await r.json()).sha;
  }
}

export function taoStore(cd) {
  return cd.mode === 'local' ? new LocalStore() : new GitHubStore(cd);
}
