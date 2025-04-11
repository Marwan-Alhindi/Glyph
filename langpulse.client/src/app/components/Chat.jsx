import { useEffect, useState } from "react"
import Message from "./Message"
import AIMessage from "./AIMessage"
import React from "react"

function Chat () {
    const [userMessages, setUserMessages] = useState([])
    const [inputText, setInputText] = useState("")
    const [answerMessages, setAnswerMessages] = useState([])
    
    function handleInputMessages () {
        if (!inputText.trim()) return

        setUserMessages(prev => [...prev, inputText])
        setInputText("") // clear input
        console.log(userMessages)
    }

    function handleAIResponse (inputText) {
        fetch(`http://localhost:8000/openai?user_input=${inputText}`)
        .then(res => res.json())
        .then(data => {
            setAnswerMessages(prev => [...prev, data])
        })
        .catch(err => {
            console.error("Fetch error:", err);
        });
    }
    
    return (
        <div className="flex-grow m-4 ml-0 p-6 bg-zinc-900 rounded-2xl border border-neutral-700 shadow-inner text-white ">
            {userMessages.length > 0 ? (
                <div>
                    {/* Top actions */}
                    <div className="flex flex-row justify-end items-center gap-x-2">
                        <button><img src='public/LLMinvite.png' /></button>
                        <button><img src='public/userInvite.png' width={30} height={30}/></button>
                        <button><img src='public/searchBar.png' width={30} height={30}/></button>
                        <button><img src='public/info.png' width={30} height={30}/></button>
                    </div>

                    <div className="max-h-[700px] overflow-y-auto flex flex-col gap-2 pr-2 text-white overflow-x-hidden">
                        {userMessages.map((message, i) => {
                            const AImessage = answerMessages[i];
                            return (
                                <React.Fragment key={i}>
                                <div className="flex left-0 justify-end mr-6">
                                    <Message text={message} />
                                </div>
                                <div className="mt-4">
                                    <img src="/chatgpt.png" width={70} height={70}></img>
                                    <div>
                                        <AIMessage text={AImessage} />
                                    </div>
                                </div>
                                </React.Fragment>
                            );
                        })}
                    </div>
                    {/* Input field */}
                    <div className="absolute bottom-20 right-80 w-full max-w-xl border border-yellow-500 rounded-xl px-4 py-3 flex items-center gap-2">
                        <input
                        type="text"
                        placeholder="Ask anything..."
                        className="bg-transparent outline-none flex-grow text-white placeholder-neutral-400"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        />
                        <button className="text-yellow-400 hover:text-yellow-300">
                        <img src="public/attachFile.png" height={30} width={30} />
                        </button>
                        <button className="text-yellow-400 hover:text-yellow-300" onClick={() => {handleInputMessages(); handleAIResponse(inputText);} }>
                        <img src="public/sendMessage.png" height={30} width={30} />
                        </button>
                    </div>
                </div>
                ) : (
                <>
                    <div className="flex flex-row justify-end items-center gap-x-2">
                    <button><img src='public/LLMinvite.png' /></button>
                    <button><img src='public/userInvite.png' width={30} height={30}/></button>
                    <button><img src='public/searchBar.png' width={30} height={30}/></button>
                    <button><img src='public/info.png' width={30} height={30} /></button>
                    </div>

                    <div className="flex flex-col h-full w-full items-center justify-center">
                    <p className="text-lg mb-6">What do you want to work on?</p>

                    <div className="w-full max-w-xl border border-yellow-500 rounded-xl px-4 py-3 flex items-center gap-2">
                        <input
                        type="text"
                        placeholder="Ask anything..."
                        className="bg-transparent outline-none flex-grow text-white placeholder-neutral-400"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        />
                        <button className="text-yellow-400 hover:text-yellow-300">
                        <img src="public/attachFile.png" height={30} width={30} />
                        </button>
                        <button className="text-yellow-400 hover:text-yellow-300" onClick={() => {handleInputMessages(); handleAIResponse(inputText);}}>
                        <img src="public/sendMessage.png" height={30} width={30} />
                        </button>
                    </div>
                    </div>
                </>
                )
            }
        </div>
    )
}

export default Chat