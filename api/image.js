import { getImage } from "../server/feedApi.mjs";

export default async function handler(request, response) {
  try {
    const image = await getImage(request.query.url || "", request.query.referer || "");
    response.setHeader("content-type", image.contentType);
    response.setHeader("cache-control", "public, max-age=7200, stale-while-revalidate=86400");
    response.status(200).send(image.body);
  } catch (error) {
    response.status(502).json({ error: "无法读取图片", detail: error instanceof Error ? error.message : String(error) });
  }
}
