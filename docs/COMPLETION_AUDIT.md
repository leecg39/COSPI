# Completion Audit

Date: 2026-06-03

## Objective

Implement the unfinished COSPI WTS site features and verify the site runs normally.

## Evidence Commands

- `npm run lint`
- `npm run build`
- `npm run verify`
- `npm run verify:dev`
- `npm run zip`
- `curl http://localhost:4100/api/health`
- Browser design smoke: `npm run verify`, `cospi-design-applied.png`, console error count `0`, DESIGN.md token checks

## Requirement Status

| Requirement | Evidence | Status |
| --- | --- | --- |
| Local app starts and serves API/UI | `verify:dev`, health endpoint, ports 4100/5173 | Passed |
| KIS market keys are connected without exposing secrets | `verify` provider status and environment key checks | Passed |
| KIS account status distinguishes missing from invalid | `verify` provider/browser checks expect `invalid` when `KIS_ACCOUNT_NO` is present but not CANO 8 digits | Passed with current account limitation |
| Domestic quotes and indices use real KIS responses | `verify` market quotes and indices checks | Passed |
| FX/rates/global index panel has no unimplemented visible item | `verify` macro check: USD/KRW, KR10Y, KR3Y, SPX, NDX all `NEAR_REALTIME`; browser check rejects N225/Nikkei | Passed |
| Chart data and indicators render from real candles | `verify` chart check with 100 candles | Passed |
| News panel renders without duplicate React keys | `verify` news string-id check and browser console error check | Passed |
| DART filings are connected | `verify` DART check for `005930`, delayed data with items | Passed |
| Financial statement/ratio panel is connected | `verify` financial rows check | Passed |
| Options chain is connected and read-only | `verify` options months/calls/puts check | Passed |
| Gemini analysis is connected | `verify` AI mode `gemini` and `NEAR_REALTIME` source | Passed |
| Login/session and protected account API behavior works | `verify` authenticated account API check for portfolio, executions, and order safety; malformed order requests return 400 instead of 500 | Passed with current account limitation |
| Browser smoke test has no console errors | `verify` browser smoke check | Passed |
| DESIGN.md visual reference is applied | `npm run verify` browser check: white background, `#0052ff` primary action, 24px card radius, chart light theme; screenshot `cospi-design-applied.png` | Passed |
| Verification does not keep creating throwaway users | `verify` reuses `verify-api@cospi.local` and `verify-ui@cospi.local`; repeated `verify:dev` kept user/session counts stable | Passed |
| ZIP artifact excludes secrets and local data | `verify` and post-zip forbidden file check | Passed |

## Remaining External Input

`KIS_ACCOUNT_NO` is missing or not a valid 8-digit KIS CANO in the current runtime. Because COSPI WTS does not fabricate account data, the following live account-backed proof cannot be completed until a real account number is provided:

- KIS balance rows from `/uapi/domestic-stock/v1/trading/inquire-balance`
- KIS daily order/execution rows from `/uapi/domestic-stock/v1/trading/inquire-daily-ccld`
- Paper/live order acceptance beyond the server-side safety and API-required checks

The current expected behavior without a valid `KIS_ACCOUNT_NO` is `API_REQUIRED`, and this is verified by `npm run verify`.

## Completion Judgment

All requirements that can be verified with the current `.env` are implemented and passing. The full objective cannot be proven complete until a valid 8-digit `KIS_ACCOUNT_NO` is supplied, because account-backed KIS data cannot be validated without that external input.
