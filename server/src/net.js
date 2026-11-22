/**
 * Outbound socket helpers shared by Edge TTS and the page fetcher.
 *
 * When an HTTP(S) proxy is configured (HTTPS_PROXY), connections are tunnelled through it with
 * CONNECT; otherwise they go direct. Callers decide *which address* to connect to (the page
 * fetcher passes an IP address it has already vetted, so the proxy never resolves names for it).
 */
import net from 'node:net';
import tls from 'node:tls';

/**
 * @param {string} proxyUrl
 * @returns {{ host: string, port: number, secure: boolean, auth: string } | null}
 */
export function parseProxy(proxyUrl) {
  if (!proxyUrl) return null;
  let u;
  try {
    u = new URL(proxyUrl.includes('://') ? proxyUrl : `http://${proxyUrl}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const secure = u.protocol === 'https:';
  const auth = u.username
    ? Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')
    : '';
  return {
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: Number(u.port) || (secure ? 443 : 80),
    secure,
    auth,
  };
}

/**
 * Whether `host` matches a NO_PROXY list (comma separated; `*`, exact names, `.suffix`,
 * `*.suffix`). CIDR entries are ignored (they only matter for literal IPs, which we never
 * send to Edge).
 * @param {string} host
 * @param {string} noProxy
 */
export function bypassesProxy(host, noProxy) {
  const h = host.toLowerCase();
  for (let entry of noProxy.split(',')) {
    entry = entry.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '*') return true;
    entry = entry.replace(/^\*\./, '.').replace(/:\d+$/, '');
    if (entry.startsWith('.') ? h.endsWith(entry) || h === entry.slice(1) : h === entry) return true;
  }
  return false;
}

/**
 * Wait for a socket to connect, with a timeout.
 * @param {net.Socket} socket
 * @param {string} event  'connect' or 'secureConnect'
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitFor(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error('connection timed out'));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    /** @param {Error} err */
    const onErr = (err) => {
      cleanup();
      socket.destroy();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onOk);
      socket.off('error', onErr);
    };
    socket.once(event, onOk);
    socket.once('error', onErr);
  });
}

/**
 * Open a raw TCP tunnel to `host:port` through an HTTP proxy with CONNECT.
 * @param {NonNullable<ReturnType<typeof parseProxy>>} proxy
 * @param {string} host  Name or IP address (IPv6 without brackets).
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<net.Socket>}
 */
async function connectTunnel(proxy, host, port, timeoutMs) {
  /** @type {net.Socket} */
  let socket;
  if (proxy.secure) {
    socket = tls.connect({ host: proxy.host, port: proxy.port, servername: net.isIP(proxy.host) ? undefined : proxy.host });
    await waitFor(socket, 'secureConnect', timeoutMs);
  } else {
    socket = net.connect({ host: proxy.host, port: proxy.port });
    await waitFor(socket, 'connect', timeoutMs);
  }
  const target = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
  const auth = proxy.auth ? `Proxy-Authorization: Basic ${proxy.auth}\r\n` : '';
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);

  await new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => fail(new Error('proxy CONNECT timed out')), timeoutMs);
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) {
        if (buf.length > 16 * 1024) fail(new Error('proxy response too large'));
        return;
      }
      cleanup();
      const statusLine = buf.subarray(0, buf.indexOf('\r\n')).toString('latin1');
      const status = Number(statusLine.split(' ')[1]);
      if (status !== 200) {
        socket.destroy();
        reject(new Error(`proxy refused CONNECT (${status || 'bad response'})`));
        return;
      }
      const rest = buf.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      resolve(undefined);
    };
    /** @param {Error} err */
    const fail = (err) => {
      cleanup();
      socket.destroy();
      reject(err);
    };
    const onClose = () => fail(new Error('proxy closed the connection'));
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', fail);
      socket.off('close', onClose);
    };
    socket.on('data', onData);
    socket.once('error', fail);
    socket.once('close', onClose);
  });
  return socket;
}

/**
 * @typedef {object} ConnectOptions
 * @property {string} address     Where to connect: an IP address or host name.
 * @property {number} port
 * @property {boolean} secure     Wrap in TLS.
 * @property {string} [servername] TLS server name to send and verify (a host name, not an IP).
 * @property {string} [proxyUrl]  HTTP proxy to tunnel through ('' = direct).
 * @property {number} [timeoutMs]
 */

/**
 * Open a connected (and, when `secure`, TLS-verified) socket.
 * @param {ConnectOptions} opts
 * @returns {Promise<net.Socket>}
 */
export async function openSocket(opts) {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const proxy = parseProxy(opts.proxyUrl || '');
  /** @type {net.Socket} */
  let raw;
  if (proxy) {
    raw = await connectTunnel(proxy, opts.address, opts.port, timeoutMs);
  } else if (!opts.secure) {
    raw = net.connect({ host: opts.address, port: opts.port });
    await waitFor(raw, 'connect', timeoutMs);
    return raw;
  }
  if (!opts.secure) return /** @type {net.Socket} */ (raw);

  const servername = opts.servername && !net.isIP(opts.servername) ? opts.servername : undefined;
  /** @type {tls.ConnectionOptions} */
  const tlsOpts = {
    servername,
    ALPNProtocols: ['http/1.1'],
    // Verify the certificate against the host name we meant, not the address we dialled.
    checkServerIdentity: (_host, cert) => tls.checkServerIdentity(opts.servername || opts.address, cert),
  };
  const sock = raw
    ? tls.connect({ ...tlsOpts, socket: raw })
    : tls.connect({ ...tlsOpts, host: opts.address, port: opts.port });
  await waitFor(sock, 'secureConnect', timeoutMs);
  return sock;
}
