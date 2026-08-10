import { bytesToHex, hexToBytes, isAddressEqual, slice, zeroAddress } from "viem";

const bytes = hexToBytes("0x0000000000000000000000000000000000000001");
const sliced = slice(bytes, bytes.length - 20);

const address = bytesToHex(sliced, { size: 20 });

const isUnset = isAddressEqual(address, zeroAddress);

// console.log(address);

// const address = slice(bytes, 12);

console.log(isUnset ? null : address);
