import { PinataSDK } from "pinata";

let pinata: PinataSDK | null = null;

function getPinata(): PinataSDK {
  if (!pinata) {
    pinata = new PinataSDK({
      pinataJwt: process.env.PINATA_API_KEY || "",
      pinataGateway: "gateway.pinata.cloud",
    });
  }
  return pinata;
}

export async function pinReport(
  markdown: string,
  contractAddress: string
): Promise<string> {
  const sdk = getPinata();

  const file = new File(
    [markdown],
    `contractlens-audit-${contractAddress}.md`,
    { type: "text/markdown" }
  );

  const result = await sdk.upload.public
    .file(file)
    .name(`ContractLens Audit - ${contractAddress}`)
    .keyvalues({
      contract: contractAddress,
      tool: "contractlens",
    });

  return result.cid;
}
