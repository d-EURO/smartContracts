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

export async function getTokenPrices(addresses: string[]): Promise<{ [key: string]: string }> {
  const options = { method: 'GET', headers: { accept: 'application/json' } };

  return fetch(`https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/${addresses}`, options)
    .then((res) => res.json())
    .then((data: TokenPrice) => data.data.attributes.token_prices)
    .catch((err) => {
      console.error(err);
      return {};
    });
}