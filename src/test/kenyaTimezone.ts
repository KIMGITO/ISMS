// The app works on Kenya time (see features/home/metrics.ts). Tests build their sample
// sales on the local clock, so they run as if the machine were in Kenya, whatever zone
// the computer or CI runner (UTC) is set to. Imported first by runTests.ts.
process.env.TZ = "Africa/Nairobi";
