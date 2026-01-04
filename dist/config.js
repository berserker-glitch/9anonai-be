"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Validate required environment variables
if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
}
exports.config = {
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "text-embedding-3-small",
    embeddingModelName: "openai/text-embedding-3-small",
    dbPath: "data/lancedb_store",
    tableName: "moroccan_laws",
};
