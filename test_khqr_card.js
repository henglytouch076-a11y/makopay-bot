const { createKhqrCard } = require('./khqr_card');

async function runTest() {
  const sampleQr = "00020101021230510016abaakhppxxx@abaa01151211130135427330208ABA Bank520459775303840540115802KH5911MAKO by H.T6003N/A625968550010PAYWAY@ABA0115550666-32806684020804190431030110501199670013179258457659501131795176576595672100170013F1BF016411FDA6804PLIK63049DF6";

  console.log("Generating pure USD Card...");
  const usdBuf = await createKhqrCard({
    merchantName: "MAKO CAMBO",
    amount: "1.00",
    currency: "USD",
    qrString: sampleQr
  });
  console.log("✅ USD-only Card generated! Size:", usdBuf.length, "bytes");

  console.log("Generating pure KHR Card...");
  const khrBuf = await createKhqrCard({
    merchantName: "MAKO CAMBO",
    amount: "4100",
    currency: "KHR",
    qrString: sampleQr
  });
  console.log("✅ KHR-only Card generated! Size:", khrBuf.length, "bytes");
}

runTest().catch(console.error);
