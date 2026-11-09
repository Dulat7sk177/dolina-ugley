// P2P-сеть через PeerJS (WebRTC). Хост создаёт комнату с кодом, друзья подключаются по коду.
import { PEER_PREFIX } from './config.js';

const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Net {
  constructor() { this.peer = null; this.conns = new Map(); this.conn = null; }

  _peer(id) {
    if (!window.Peer) throw new Error('Библиотека PeerJS не загрузилась (нет интернета?)');
    return id ? new window.Peer(id, { debug: 1 }) : new window.Peer({ debug: 1 });
  }

  host({ onData, onLeave }) {
    return new Promise((resolve, reject) => {
      const code = Array.from({ length: 5 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('');
      let peer;
      try { peer = this._peer(PEER_PREFIX + code); } catch (e) { reject(e); return; }
      this.peer = peer;
      let opened = false;
      const timer = setTimeout(() => reject(new Error('Сервер связи не отвечает')), 10000);
      peer.on('open', () => { opened = true; clearTimeout(timer); resolve(code); });
      peer.on('error', (err) => { console.warn('[net]', err.type, err); if (!opened) { clearTimeout(timer); reject(err); } });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* ignore */ } });
      peer.on('connection', (conn) => {
        conn.on('open', () => this.conns.set(conn.peer, conn));
        conn.on('data', (d) => onData(conn.peer, d));
        const drop = () => { if (this.conns.delete(conn.peer)) onLeave(conn.peer); };
        conn.on('close', drop);
        conn.on('error', drop);
      });
    });
  }

  join(code, { onData, onClose }) {
    return new Promise((resolve, reject) => {
      let peer;
      try { peer = this._peer(); } catch (e) { reject(e); return; }
      this.peer = peer;
      let opened = false;
      const timer = setTimeout(() => { if (!opened) reject(new Error('Таймаут подключения')); }, 15000);
      peer.on('open', () => {
        const conn = peer.connect(PEER_PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => { opened = true; clearTimeout(timer); resolve(); });
        conn.on('data', onData);
        conn.on('close', onClose);
      });
      peer.on('error', (err) => {
        console.warn('[net]', err.type, err);
        if (!opened) { clearTimeout(timer); reject(err.type === 'peer-unavailable' ? new Error('Комната не найдена — проверь код') : err); }
      });
    });
  }

  send(m) { if (this.conn && this.conn.open) this.conn.send(m); }
  sendTo(id, m) { const c = this.conns.get(id); if (c && c.open) c.send(m); }
  broadcast(m) { for (const c of this.conns.values()) if (c.open) c.send(m); }
  destroy() { try { this.peer?.destroy(); } catch { /* ignore */ } }
}
