/**
 * E2E encryption using tweetnacl (NaCl box).
 * Same algorithm as internal/crypto/e2e.go — Curve25519 + XSalsa20 + Poly1305.
 * The relay server CANNOT read any message content.
 */

import nacl from "tweetnacl";
import { getRandomValues as expoGetRandomValues } from "expo-crypto";
import { decodeBase64, encodeBase64, decodeUTF8, encodeUTF8 } from "tweetnacl-util";

// React Native doesn't have crypto.getRandomValues — polyfill tweetnacl's PRNG
// using expo-crypto's native implementation.
nacl.setPRNG((x: Uint8Array, n: number) => {
  const v = new Uint8Array(n);
  expoGetRandomValues(v);
  for (let i = 0; i < n; i++) x[i] = v[i];
});

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Generate a new NaCl box key pair */
export function generateKeyPair(): KeyPair {
  return nacl.box.keyPair();
}

/** Get public key as base64 string (for sharing during pairing) */
export function publicKeyToBase64(publicKey: Uint8Array): string {
  return encodeBase64(publicKey);
}

/** Parse a base64 public key string back to Uint8Array */
export function parsePublicKey(base64Key: string): Uint8Array {
  return decodeBase64(base64Key);
}

/**
 * Encrypt a plaintext message for the peer.
 * Returns { nonce: base64, ciphertext: base64 }
 */
export function encrypt(
  plaintext: string,
  peerPublicKey: Uint8Array,
  mySecretKey: Uint8Array
): { nonce: string; ciphertext: string } {
  const messageBytes = decodeUTF8(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  const encrypted = nacl.box(messageBytes, nonce, peerPublicKey, mySecretKey);

  if (!encrypted) {
    throw new Error("Encryption failed");
  }

  return {
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(encrypted),
  };
}

/**
 * Decrypt a ciphertext message from the peer.
 * Returns the plaintext string.
 */
export function decrypt(
  nonceBase64: string,
  ciphertextBase64: string,
  peerPublicKey: Uint8Array,
  mySecretKey: Uint8Array
): string {
  const nonce = decodeBase64(nonceBase64);
  const ciphertext = decodeBase64(ciphertextBase64);

  const decrypted = nacl.box.open(ciphertext, nonce, peerPublicKey, mySecretKey);

  if (!decrypted) {
    throw new Error("Decryption failed: invalid ciphertext or wrong key");
  }

  return encodeUTF8(decrypted);
}
