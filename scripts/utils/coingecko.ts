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

export async function getTokenPrices(addresses: string[], conversionRate?: number): Promise<{ [key: string]: string }> {
  const options = { method: 'GET', headers: { accept: 'application/json' } };

  return fetch(`https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/${addresses}`, options)
    .then((res) => res.json())
    .then((data: TokenPrice) => {
      const prices = data.data.attributes.token_prices;
      if (conversionRate) {
        for (const address in prices) {
          const price = prices[address];
          if (price) {
            prices[address] = String(Number(price) * conversionRate);
          }
        }
      }

      return prices;
    })
    .catch((err) => {
      console.error(err);
      return {};
    });
}

export async function getUsdToEur(): Promise<number> {
  const options = { method: 'GET', headers: { accept: 'application/json' } };

  return fetch('https://api.coingecko.com/api/v3/simple/price?ids=usd&vs_currencies=eur', options)
    .then((res) => res.json())
    .then((data: any) => Number(data.usd.eur))
    .catch((err) => {
      console.error(err);
      return 0;
    });
}
