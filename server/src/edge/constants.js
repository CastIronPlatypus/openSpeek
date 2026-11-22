/**
 * Protocol constants for Edge's read-aloud service, from rany2/edge-tts 7.3.1
 * (src/edge_tts/constants.py). Microsoft changes these from time to time; when Edge TTS starts
 * failing with 403, compare against the current upstream file first.
 */
export const BASE_HOST = 'speech.platform.bing.com';
export const BASE_PATH = '/consumer/speech/synthesize/readaloud';
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

export const WSS_URL = `wss://${BASE_HOST}${BASE_PATH}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
export const VOICE_LIST_URL = `https://${BASE_HOST}${BASE_PATH}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;

export const CHROMIUM_FULL_VERSION = '143.0.3650.75';
export const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
export const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;

export const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
export const MP3_BITRATE_BPS = 48_000;
export const TICKS_PER_SECOND = 10_000_000;

export const BASE_HEADERS = {
  'User-Agent':
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'en-US,en;q=0.9',
};

export const WSS_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';

export const WSS_HEADERS = {
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  ...BASE_HEADERS,
};

export const VOICE_HEADERS = {
  Authority: BASE_HOST,
  'Sec-CH-UA': `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}", "Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,
  'Sec-CH-UA-Mobile': '?0',
  Accept: '*/*',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  ...BASE_HEADERS,
};
