import { listGames } from "../server/s3.ts";

const { games } = await listGames();
process.stdout.write(`${games.length} pasta(s)\n${games.map((game) => `- ${game.name}`).join("\n")}\n`);
