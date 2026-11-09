#!/usr/bin/env bash
# Sets up Topsqill.ai on your own machine, using your own PostgreSQL.
# Run from this folder:  bash setup.sh
set -e

DB_URL="${DATABASE_URL:-postgres://postgres@localhost:5432/topsqill}"
REDIS="${REDIS_URL:-redis://localhost:6379}"
SECRET="${JWT_SECRET:-$(head -c 32 /dev/urandom | base64 | tr -d '/+=' )}"
PROXY_SECRET="${INTERNAL_PROXY_SECRET:-$(head -c 32 /dev/urandom | base64 | tr -d '/+=' )}"

echo "Using database: $DB_URL"
echo

echo "1/4  Backend dependencies"
cd topsqill-backend
npm install --silent

cat > .env <<ENV
NODE_ENV=development
PORT=8080
DATABASE_URL=$DB_URL
REDIS_URL=$REDIS
JWT_SECRET=$SECRET
INTERNAL_PROXY_SECRET=$PROXY_SECRET
TRUST_PROXY_HOPS=0
CDN_BASE_URL=
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
ENV

echo "2/4  Database migrations and demo data"
set -a; . ./.env; set +a
npm run db:migrate
npm run db:seed
npm run build --silent

echo "3/4  Web app dependencies"
cd ../topsqill-web
npm install --silent
cat > .env <<ENV
API_URL=http://localhost:8080
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_SITE_URL=http://localhost:3000
INTERNAL_PROXY_SECRET=$PROXY_SECRET
ENV
npm run build

echo "4/4  Done"
cd ..
cat <<'MSG'

Everything is ready. Open two terminals:

  Terminal 1:  cd topsqill-backend && npm start
  Terminal 2:  cd topsqill-web && npm start

Then open http://localhost:3000

Sign in with any 10-digit mobile number. The one-time code is printed in
Terminal 1 (look for "OTP for +91... is 123456").

To make yourself an admin:
  psql topsqill -c "UPDATE users SET is_admin = true WHERE phone = '+91YOURNUMBER';"
Sign out and back in, and the Admin link appears in the top bar.
MSG
