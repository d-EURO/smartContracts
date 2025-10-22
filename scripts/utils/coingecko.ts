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

// Cache for token prices
interface TokenPricesCache {
  prices: { [key: string]: string };
  timestamp: number;
  conversionRate?: number;
}

let tokenPricesCache: TokenPricesCache | null = null;
const TOKEN_PRICES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for token prices
const API_TIMEOUT = 10000; // 10 seconds

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
    // TODO: Ensure the API endpoint is correct for Citrea
    const response = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/citrea/token_price/${addresses.join(',')}`, options);
    
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

