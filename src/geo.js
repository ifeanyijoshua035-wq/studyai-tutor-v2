// Handles three things:
//  1. Detecting a visitor's IP and country (best-effort, via ipinfo.io).
//  2. Mapping that country to a pricing tier: 'nigeria' | 'africa' | 'row'.
//  3. Fetching a live NGN exchange rate purely for DISPLAY purposes on the
//     pricing/upgrade screen - the actual Flutterwave charge is always in NGN,
//     since that's the currency a Nigeria-registered payment account settles
//     in. International cardholders' own banks convert the NGN charge to
//     their home currency automatically at the card network's real-time
//     rate - the same way any international NGN purchase works.

const AFRICAN_COUNTRY_CODES = new Set([
  'DZ','AO','BJ','BW','BF','BI','CV','CM','CF','TD','KM','CG','CD','CI','DJ',
  'EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW','KE','LS','LR','LY','MG',
  'MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO',
  'ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW','EH'
]);

const TIER_AMOUNTS_NGN = { nigeria: 3000, africa: 5000, row: 8000 };

// Used only to show visitors a "about X in your currency" estimate
// before checkout. Not exhaustive - falls back to USD for any country not
// listed here.
const CURRENCY_BY_COUNTRY = {
  NG:'NGN', GH:'GHS', KE:'KES', ZA:'ZAR', EG:'EGP', MA:'MAD', TN:'TND', DZ:'DZD',
  ET:'ETB', UG:'UGX', TZ:'TZS', RW:'RWF', ZM:'ZMW', ZW:'ZWL', MZ:'MZN', AO:'AOA',
  CI:'XOF', SN:'XOF', ML:'XOF', BF:'XOF', NE:'XOF', TG:'XOF', BJ:'XOF', GW:'XOF',
  CM:'XAF', GA:'XAF', CG:'XAF', TD:'XAF', CF:'XAF', GQ:'XAF', NA:'NAD', BW:'BWP',
  MW:'MWK', MG:'MGA', MU:'MUR', SC:'SCR', LS:'LSL', SZ:'SZL', SS:'SSP', SD:'SDG',
  US:'USD', GB:'GBP', CA:'CAD', AU:'AUD', DE:'EUR', FR:'EUR', ES:'EUR', IT:'EUR',
  NL:'EUR', IE:'EUR', PT:'EUR', IN:'INR', CN:'CNY', JP:'JPY', BR:'BRL', MX:'MXN',
  AE:'AED', SA:'SAR', SG:'SGD', MY:'MYR', PH:'PHP', PK:'PKR', TR:'TRY', RU:'RUB'
};

function getClientIp(req) {
  // For geolocation specifically (unlike rate-limiting), we want the original,
  // leftmost IP in the X-Forwarded-For chain, regardless of how many proxy
  // hops Render's infrastructure adds - guessing the exact hop count for
  // Express's 'trust proxy' setting was landing on an intermediate server's
  // IP instead of the real visitor's. Spoofing this only affects the
  // spoofer's own price tier, so there's no security downside to reading it
  // directly here the way there would be for rate-limiting.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
}

function isPrivateIp(ip) {
  if (!ip) return true;
  return (
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('::ffff:127.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  );
}

// Best-effort geolocation using ipinfo.io (free tier: 50,000 lookups/month
// with a free token from ipinfo.io/signup - set IPINFO_TOKEN in your env).
// We switched to this from ipapi.co after discovering ipapi.co's anonymous
// free tier was being rate-limited, likely from Render's shared outbound IPs
// being used by many different apps at once, not just this one.
async function lookupCountry(ip) {
  if (isPrivateIp(ip)) {
    return { countryCode: 'NG', countryName: 'Nigeria (local default)' };
  }
  const token = process.env.IPINFO_TOKEN;
  try {
    const url = token
      ? `https://ipinfo.io/${ip}/json?token=${token}`
      : `https://ipinfo.io/${ip}/json`; // works unauthenticated at low volume, but may itself get rate-limited without a token
    const res = await fetch(url);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      console.error('Geo lookup returned non-JSON. ip=%s status=%s body=%s', ip, res.status, text.slice(0, 200));
      return { countryCode: null, countryName: null };
    }
    const data = await res.json();
    if (data && data.country && !data.error) {
      return { countryCode: data.country, countryName: data.country || null };
    }
    console.error('Geo lookup returned no country. ip=%s status=%s body=%j', ip, res.status, data);
  } catch (e) {
    console.error('Geo lookup request failed. ip=%s error=%s', ip, e.message);
  }
  return { countryCode: null, countryName: null };
}

function getTier(countryCode) {
  if (countryCode === 'NG') return 'nigeria';
  if (countryCode && AFRICAN_COUNTRY_CODES.has(countryCode)) return 'africa';
  return 'row';
}

// Live NGN to target-currency rate, for display estimates only. Cached in
// memory for 6 hours. Uses the free, keyless open.er-api.com endpoint - if
// that provider ever changes or goes away, swap in another (e.g.
// exchangerate-api.com, which requires a free API key).
let rateCache = { rates: null, fetchedAt: 0 };
const CACHE_MS = 6 * 60 * 60 * 1000;

async function getNgnToCurrencyRate(currency) {
  if (currency === 'NGN') return 1;
  const now = Date.now();
  if (!rateCache.rates || (now - rateCache.fetchedAt) >= CACHE_MS) {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/NGN');
      const data = await res.json();
      if (data && data.result === 'success' && data.rates) {
        rateCache = { rates: data.rates, fetchedAt: now };
      }
    } catch (e) {
      console.error('FX rate fetch failed:', e.message);
    }
  }
  return rateCache.rates ? rateCache.rates[currency] || null : null;
}

module.exports = {
  getClientIp,
  lookupCountry,
  getTier,
  getNgnToCurrencyRate,
  TIER_AMOUNTS_NGN,
  CURRENCY_BY_COUNTRY,
  AFRICAN_COUNTRY_CODES
};