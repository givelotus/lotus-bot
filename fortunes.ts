import { PrismaClient } from "./prisma/prisma-client-js";
import { Configuration, OpenAIApi } from "openai";
import * as fs from "fs";
import * as path from "path";
import config from './config';


const openaiconfig = new Configuration({
    organization:config.openai.org,
    apiKey: config.openai.key
});

const openai = new OpenAIApi(openaiconfig);
let promptFile: string = '';

const files = fs.readdirSync(path.join(process.cwd(), "fortune-prompts"));

let max = files.length - 1;
let min = 0;
let index = Math.round(Math.random() * (max - min) + min);
let file = files[index];
promptFile = fs.readFileSync(path.join(process.cwd(), "fortune-prompts", file)).toString();


getFortunes();

async function getFortunes(){
    try {
        const aiRequest = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "user",
                content: promptFile,
                name: "lotus"
            }],
            temperature: 0.7,
            user: "lotus-b-fortune"
        });

        console.info(promptFile);
        console.log();
        let aires = aiRequest.data.choices[0].message?.content;
        //console.info(aires);
        const aiResponse = JSON.parse(aires);
        console.info(aiResponse);
        
        // IDK, insert into a DB somewhere or something. ¯\_(ツ)_/¯

    } catch (error) {
        if (error.response) {
            console.log(error.response.status);
            console.log(error.response.data);
        } else {
            console.log(error.message);
        }
    } 
}

