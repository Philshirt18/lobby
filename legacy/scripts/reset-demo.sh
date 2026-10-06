#!/bin/sh
# Fresh demo state: new sender whitelist (forgets approved senders), empty database, seeded customer + invoices,
# and the indexer starts from the current block. Money already on chain stays where it is.
set -e
cd "$(dirname "$0")/.."
kill $(lsof -ti :8787) 2>/dev/null || true
set -a; . ./.env; set +a
pnpm -s setup
BLOCK=$(curl -s -X POST "$RPC_URL" -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
  | python3 -c "import sys,json;print(int(json.load(sys.stdin)['result'],16))")
if grep -q '^START_BLOCK=' .env; then sed -i '' "s/^START_BLOCK=.*/START_BLOCK=$BLOCK/" .env; else echo "START_BLOCK=$BLOCK" >> .env; fi
rm -f lobby.db
set -a; . ./.env; set +a
pnpm -s seed
echo "Demo reset at block $BLOCK. Start the server with: pnpm start"
