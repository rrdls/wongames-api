/**
 * game service
 */

import { factories } from "@strapi/strapi";

import axios from "axios";
import slugify from "slugify";

import qs from "querystring";

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Exception(e) {
  return { e, data: e.data && e.data.errors && e.data.errors };
}

async function getGameInfo(slug: string) {
  try {
    const jsdom = require("jsdom");
    const { JSDOM } = jsdom;
    const body = await axios.get(`https://www.gog.com/game/${slug}`);
    const dom = new JSDOM(body.data);
    const description = dom.window.document.querySelector(".description");
    return {
      rating: "BR0",
      description: description.innerHTML,
      short_description: description.textContent.slice(0, 160),
    };
  } catch (e) {
    console.log("getGameInfo", Exception(e));
  }
}

async function getByName(name: string, entityName: string) {
  const item: any = await strapi.entityService.findMany(
    `api::${entityName}.${entityName}`,
    {
      filters: { name },
    }
  );

  return item.length !== 0 ? item[0] : null;
}

async function create(name: string, entityName: string) {
  const item = await getByName(name, entityName);

  if (!item) {
    return await strapi.entityService.create(
      `api::${entityName}.${entityName}`,
      {
        data: {
          name,
          slug: slugify(name).toLowerCase(),
          publishedAt: new Date().toISOString(),
        },
      }
    );
  }
}

async function createManyToManyData(products) {
  const developers = {};
  const publishers = {};
  const categories = {};
  const platforms = {};

  products.forEach((product) => {
    const { developer, publisher, genres, supportedOperatingSystems } = product;
    genres &&
      genres.forEach((item) => {
        categories[item] = true;
      });
    supportedOperatingSystems &&
      supportedOperatingSystems.forEach((item) => {
        platforms[item] = true;
      });
    developers[developer] = true;
    publishers[publisher] = true;
  });

  return Promise.all([
    ...Object.keys(developers).map((name) => create(name, "developer")),
    ...Object.keys(publishers).map((name) => create(name, "publisher")),
    ...Object.keys(categories).map((name) => create(name, "category")),
    ...Object.keys(platforms).map((name) => create(name, "platform")),
  ]);
}

async function createGames(products) {
  await Promise.all(
    products.map(async (product) => {
      const item = await getByName(product.title, "game");

      if (!item) {
        console.log(`Creating: ${product.title}...`);

        const game = await strapi.entityService.create("api::game.game", {
          data: {
            name: product.title,
            slug: product.slug.replace(/_/g, "-"),
            price: product.price.amount,
            release_date: new Date(
              Number(product.globalReleaseDate) * 1000
            ).toISOString(),
            categories: await Promise.all(
              product.genres.map((name) => getByName(name, "category"))
            ),
            platforms: await Promise.all(
              product.supportedOperatingSystems.map((name) =>
                getByName(name, "platform")
              )
            ),
            developers: [await getByName(product.developer, "developer")],
            publisher: await getByName(product.publisher, "publisher"),
            ...(await getGameInfo(product.slug)),
            publishedAt: new Date().toISOString(),
          },
        });

        await setImage({ image: product.image, game });
        await Promise.all(
          product.gallery.slice(0, 5).map((url) => {
            setImage({ image: url, game, field: "gallery" });
          })
        );

        await timeout(2000);

        return game;
      }
    })
  );
}

async function setImage({ image, game, field = "cover" }) {
  try {
    const url = `https:${image}_bg_crop_1680x655.jpg`;
    console.log(url);
    const { data } = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(data, "base64");
    const FormData = require("form-data");
    const formData = new FormData();
    formData.append("refId", game.id);
    formData.append("ref", "api::game.game");
    formData.append("field", field);
    formData.append("files", buffer, { filename: `${game.slug}.jpg` });
    console.log(`Uploading ${field} image: ${game.slug}.jpg`);

    await axios.post(
      `http://${strapi.config.host}:${strapi.config.port}/api/upload`,
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      }
    );
  } catch (e) {
    console.log("setImage", Exception(e));
  }
}

export default factories.createCoreService("api::game.game", ({ strapi }) => ({
  async populate(params) {
    try {
      const gogApiUrl = `https://www.gog.com/games/ajax/filtered?mediaType=game&${qs.stringify(
        params
      )}`;

      const {
        data: { products },
      } = await axios.get(gogApiUrl);

      await createManyToManyData(products);
      await createGames(products);
    } catch (e) {
      console.log("populate", Exception(e));
    }
  },
}));
