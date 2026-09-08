# CourtKeyRegistry Freeze Protocol — Demo

## Setup (one time)

```
cd land-demo
npm install
npx hardhat compile
```

## Run (every time)

Open THREE terminal windows, all inside land-demo/:

Terminal 1 — start local blockchain:
```
npx hardhat node
```
(keep this running, don't close it)

Terminal 2 — deploy contract:
```
npx hardhat run scripts/deploy.js --network localhost
```
(this prints the contract address and writes public/config.json)

Terminal 3 — serve the frontend:
```
npx http-server public -p 3000 -c-1
```

Then open http://localhost:3000 in your browser.

## Demo flow

1. Court tab: select "Registered Judge", enter token ID 1,
   enter case number, click Sign & Submit. Watch it get ACCEPTED.

2. Court tab: switch to "Unauthorized" account, same data,
   click Sign & Submit. Watch it get REJECTED.

3. Public tab: enter token ID 1, click Check. Shows FROZEN.
   Enter token ID 2, click Check. Shows NOT FROZEN.
