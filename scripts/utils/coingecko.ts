interface TokenPrice {
  data: {
    id: string;
    type: string;
    attributes: {
      token_prices: {
        [key: string]: string;
      };
    };
  };
}

// Cache for EUR/USD exchange rate
interface ExchangeRateCache {
  rate: number;
  timestamp: number;
}

// Cache for token prices
interface TokenPricesCache {
  prices: { [key: string]: string };
  timestamp: number;
  conversionRate?: number;
}

let exchangeRateCache: ExchangeRateCache | null = null;
let tokenPricesCache: TokenPricesCache | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
const TOKEN_PRICES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for token prices
const API_TIMEOUT = 10000; // 10 seconds
const DEFAULT_EUR_USD_RATE = 0.85; // Fallback rate

function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

export async function getTokenPrices(addresses: string[], conversionRate?: number): Promise<{ [key: string]: string }> {
  // Check cache first
  if (tokenPricesCache && 
      (Date.now() - tokenPricesCache.timestamp) < TOKEN_PRICES_CACHE_TTL &&
      tokenPricesCache.conversionRate === conversionRate) {
    // Check if all requested addresses are in cache
    const allAddressesInCache = addresses.every(addr => 
      addr.toLowerCase() in tokenPricesCache!.prices
    );
    if (allAddressesInCache) {
      const result: { [key: string]: string } = {};
      addresses.forEach(addr => {
        const price = tokenPricesCache!.prices[addr.toLowerCase()];
        if (price) {
          result[addr.toLowerCase()] = price;
        }
      });
      return result;
    }
  }

  const controller = createTimeoutController(API_TIMEOUT);
  const options = { 
    method: 'GET', 
    headers: { accept: 'application/json' },
    signal: controller.signal
  };

  try {
    const response = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/${addresses.join(',')}`, options);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data: TokenPrice = await response.json();
    const prices = data.data.attributes.token_prices;
    
    if (conversionRate) {
      for (const address in prices) {
        const price = prices[address];
        if (price) {
          prices[address] = String(Number(price) * conversionRate);
        }
      }
    }

    // Update cache
    tokenPricesCache = {
      prices,
      timestamp: Date.now(),
      conversionRate
    };

    return prices;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error('Token prices API request timed out, using cached prices if available');
    } else {
      console.error('Error fetching token prices:', err.message);
    }
    
    // Return cached prices if available
    if (tokenPricesCache) {
      console.log('Using cached token prices');
      const result: { [key: string]: string } = {};
      addresses.forEach(addr => {
        const price = tokenPricesCache!.prices[addr.toLowerCase()];
        if (price) {
          result[addr.toLowerCase()] = price;
        }
      });
      return result;
    }
    
    return {};
  }
}

export async function getUsdToEur(): Promise<number> {
  // Check cache first
  if (exchangeRateCache && (Date.now() - exchangeRateCache.timestamp) < CACHE_TTL) {
    return exchangeRateCache.rate;
  }

  const controller = createTimeoutController(API_TIMEOUT);
  const options = { 
    method: 'GET', 
    headers: { accept: 'application/json' },
    signal: controller.signal
  };

  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=usd&vs_currencies=eur', options);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data: any = await response.json();
    const rate = Number(data.usd.eur);
    
    if (isNaN(rate) || rate <= 0) {
      throw new Error('Invalid exchange rate received');
    }

    // Update cache
    exchangeRateCache = {
      rate,
      timestamp: Date.now()
    };
    
    return rate;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error('EUR/USD exchange rate API request timed out, using fallback or cached rate');
    } else {
      console.error('Error fetching EUR/USD exchange rate:', err.message);
    }
    
    // Return cached rate if available, otherwise use default
    if (exchangeRateCache) {
      console.log('Using cached EUR/USD exchange rate:', exchangeRateCache.rate);
      return exchangeRateCache.rate;
    }
    
    console.log('Using default EUR/USD exchange rate:', DEFAULT_EUR_USD_RATE);
    return DEFAULT_EUR_USD_RATE;
  }
}
