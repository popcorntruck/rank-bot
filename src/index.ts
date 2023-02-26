/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { z } from "zod";
import { verifyKey } from "discord-interactions";
import {
  APIInteraction,
  InteractionType,
  APIInteractionResponse,
  InteractionResponseType,
  ApplicationCommandType,
  ApplicationCommandOptionType,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
export interface Env {
  DISCORD_TOKEN?: string | null;
  DISCORD_APPID?: string | null;
}

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPID: z.string().min(1),
  DISCORD_PUBKEY: z.string().min(1),
});

const signatureSchema = z.object({
  "X-Signature-Ed25519": z.string().min(1),
  "X-Signature-Timestamp": z.string().min(1),
});

const TRACKER_URL = "https://valorant-server.iesdev.com/graphql";
const RIOT_ACCOUNT_QUERY =
  "query+RiotAccount($gameName:String,$tagLine:String){riotAccount(gameName:$gameName,tagLine:$tagLine){gameName+tagLine+puuid+valorantProfile{internalUuid+region+level+xp+lastPlayedAt+latestTier+latestRankedRating}}}";

const V_RANK_MAP: Record<number, string> = {
  0: "Unranked",
  3: "Iron 1",
  4: "Iron 2",
  5: "Iron 3",
  6: "Bronze 1",
  7: "Bronze 2",
  8: "Bronze 3",
  9: "Silver 1",
  10: "Silver 2",
  11: "Silver 3",
  12: "Gold 1",
  13: "Gold 2",
  14: "Gold 3",
  15: "Platinum 1",
  16: "Platinum 2",
  17: "Platinum 3",
  18: "Diamond 1",
  19: "Diamond 2",
  20: "Diamond 3",
  21: "Ascendent 1",
  22: "Ascendent 2",
  23: "Ascendent 3",
  24: "Immortal 1",
  25: "Immortal 2",
  26: "Immortal 3",
  27: "Radiant",
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (!(request.method == "POST" || request.method == "PATCH")) {
      return new Response("Invalid Method", {
        status: 405,
      });
    }

    const envData = envSchema.safeParse(env);

    if (!envData.success) {
      return new Response("Internal Server Error", {
        status: 500,
      });
    }

    if (request.method === "PATCH") {
      //sync command
      const commandData: RESTPostAPIApplicationCommandsJSONBody = {
        type: ApplicationCommandType.ChatInput,
        name: "rank",
        description: "Get the user's rank from their Riot ID",
        options: [
          {
            name: "riotid",
            description: "User's Riot ID - name#tagline",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      };

      const res = await fetch(
        `https://discord.com/api/v10/applications/${envData.data.DISCORD_APPID}/commands`,
        {
          method: "PUT",
          body: JSON.stringify([commandData]),
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bot " + envData.data.DISCORD_TOKEN,
          },
        }
      );

      return new Response(JSON.stringify(res.ok));
    }

    const reqHeaders = signatureSchema.safeParse({
      "X-Signature-Ed25519": request.headers.get("X-Signature-Ed25519"),
      "X-Signature-Timestamp": request.headers.get("X-Signature-Timestamp"),
    });

    const body = await request.text();

    if (
      !reqHeaders.success ||
      !verifyKey(
        body,
        reqHeaders.data["X-Signature-Ed25519"],
        reqHeaders.data["X-Signature-Timestamp"],
        envData.data.DISCORD_PUBKEY
      )
    ) {
      return new Response("Invalid Request Signature", {
        status: 400,
      });
    }

    const interaction = JSON.parse(body) as APIInteraction;

    if (interaction.type === InteractionType.Ping) {
      const res: APIInteractionResponse = {
        type: InteractionResponseType.Pong,
      };

      return json(res);
    } else if (
      interaction.type === InteractionType.ApplicationCommand &&
      interaction.data.type === ApplicationCommandType.ChatInput
    ) {
      //this does the same thing no matter what command is used, should make commands syste m
      const riotId = interaction.data.options?.find(
        ({ name }) => name === "riotid"
      );

      if (riotId && riotId.type === ApplicationCommandOptionType.String) {
        const split = riotId.value
          .replace(/\s/g, "")
          .split("#")
          .filter((v) => v !== "");

        if (split.length !== 2) {
          const res: APIInteractionResponse = {
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content: "Invalid Riot ID",
            },
          };

          return json(res);
        }

        const [name, tagline] = split;

        const vData = await fetch(
          encodeURI(
            `${TRACKER_URL}?query=${RIOT_ACCOUNT_QUERY}&variables=${JSON.stringify(
              {
                gameName: name,
                tagLine: tagline,
              }
            )}`
          )
        );

        const vJson = await vData.json<{
          errors: any;
          data: {
            riotAccount: {
              valorantProfile: {
                latestTier: number;
              };
            } | null;
          };
        }>();

        if (!vJson["data"] || vJson.data.riotAccount === null) {
          const res: APIInteractionResponse = {
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content: "Failed to fetch user data",
            },
          };

          return json(res);
        }

        const res: APIInteractionResponse = {
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content: `${name}#${tagline}'s rank: ${
              V_RANK_MAP[vJson.data.riotAccount.valorantProfile.latestTier] ||
              "Unknown"
            }`,
          },
        };

        return json(res);
      }
    }

    return new Response("Invalid request", {
      status: 400,
    });
  },
};

function json(data: unknown): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json;charset=UTF-8",
    },
  });
}
