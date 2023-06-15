import { Prisma, PrismaClient } from "../prisma/prisma-client-js";
import { Configuration, OpenAIApi } from "openai";
import * as fs from "fs/promises";
import * as path from "path";
import config from '../config';
import { newUUID } from "../util";

const prisma = new PrismaClient();
const aiConfig = new Configuration({
  organization: config.openai.org,
  apiKey: config.openai.key
});
const openai = new OpenAIApi(aiConfig);

const main = async () => {
  try {
    const promptsPath = path.join(process.cwd(), 'scripts', "fortune-prompts");
    const promptFiles = await fs.readdir(promptsPath);
    const index = Math.round(Math.random() * (promptFiles.length - 1));
    const promptCategory = promptFiles[index];
    const filePath = path.join(promptsPath, promptCategory);
    const promptBuf = await fs.readFile(filePath);
    // Generate and submit the request using provided prompt
    console.log(`INFO: Sending request to OpenAI for fortunes in category ${promptCategory}`);
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      user: "lotus-b-fortune",
      temperature: 0.7,
      messages: [{
        role: "user",
        content: promptBuf.toString(),
        name: "lotus"
      }],
    });
    // Get the AI response message
    console.log(`INFO: Processing response from OpenAI`);
    const json = response.data.choices[0].message?.content;
    if (!json) {
      throw new Error('No response from API');
    }
    const fortuneArray: string[] = JSON.parse(json);
    const fortuneInserts: Prisma.FortuneCreateInput[] = [];
    fortuneArray.map(fortuneString => fortuneInserts.push({
      id: newUUID(),
      fortune: fortuneString,
      category: promptCategory,
      added_date: new Date()
    }));
    console.log(`INFO: Inserting new fortunes into database`);
    await prisma.$connect();
    fortuneInserts.map(async (insert) => {
      try {
        await prisma.fortune.create({ data: insert });
      } catch (e: any) {
        console.warn(`WARN: This fortune has already been saved: "${insert.fortune}"`);
      }
    });
  } catch (e: any) {
    switch (!undefined) {
      case e.response:
        console.log(e.response.status);
        console.log(e.response.data);
      case e.message:
        console.log(e.message);
    }
  } finally {
    await prisma.$disconnect();
  }
};

main();