const crypto = require("crypto");
require("dotenv").config();

const ALGORITHM = "aes-256-cbc";
const MASTER_KEY_STRING = process.env.MASTER_ENCRYPTION_KEY;

if (!MASTER_KEY_STRING) {
  throw new Error(".envに MASTER_ENCRYPTION_KEY を設定してください。");
}

function getKey(salt) {
  return crypto.scryptSync(MASTER_KEY_STRING, salt, 32);
}

function encrypt(text, salt) {
  const key = getKey(salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedText, salt) {
  try {
    const key = getKey(salt);
    const [ivHex, encryptedDataHex] = encryptedText.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedDataHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    return null;
  }
}

module.exports = { encrypt, decrypt };