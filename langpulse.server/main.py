# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv()  # Load variables from .env

app = FastAPI()

# Allow frontend to access backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # React dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to Langpulse backend"}

@app.get("/openai")
def get_openai(user_input: str):
    client = OpenAI(
        # This is the default and can be omitted
        api_key=os.getenv("OPENAI_API_KEY")
    )

    response = client.responses.create(
        model="gpt-4o",
        instructions="I would like you to talk like a japanese girl and put the english as well",
        input=user_input
    )
    return {response.output_text}

init_models = {}

@app.get("/inviteLLM")
def init_model(model_id: int, model_name: str, model_type: str, model_instruct: str):
    if model_type == "openai":
        init_models[model_id] = {
            "model_name": model_name,
            "client": OpenAI(api_key=os.getenv("OPENAI_API_KEY")),
            "model_type": model_type,
            "model_instruct": model_instruct
        }

    response = init_models[model_name]["client"].chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "user", "content": f"Please type a message to indicate you have joined the chat with mentioning your name. Your name is: {model_name}"}
        ]
    )

    return {"response": response.choices[0].message.content}

@app.get("/askLLM")
def ask_LLM(user_input: str, model_id):

    response = init_models[model_id]["client"].chat.completions.create(
                model="gpt-4o",
        messages=[
        {"role": "system", "content": init_models[model_id]["model_instruct"]},
        {"role": "user", "content": user_input}
        ]
    )
    return {"response": response.choices[0].message.content}