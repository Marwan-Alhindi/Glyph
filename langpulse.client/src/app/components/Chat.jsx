function Chat () {
    return (
        <div className="flex-grow m-4 ml-0 p-6 bg-zinc-900 rounded-2xl border border-neutral-700 shadow-inner text-white">
            <div className="flex flex-row justify-end items-center gap-x-2">
                <button><img src='public/LLMinvite.png'></img></button>
                <button><img src='public/userInvite.png'></img></button>
                <button><img src='public/searchBar.png'></img></button>
                <button><img src='public/info.png'></img></button>
            </div>
            <div className="flex flex-col h-full w-full items-center justify-center">
                <p className="text-lg mb-6">What do you want to work on?</p>

                <div className="w-full max-w-xl border border-yellow-500 rounded-xl px-4 py-3 flex items-center gap-2">
                    <input
                        type="text"
                        placeholder="Ask anything..."
                        className="bg-transparent outline-none flex-grow text-white placeholder-neutral-400"
                    />
                    <button className="text-yellow-400 hover:text-yellow-300">
                        <img src="public/attachFile.png"></img>
                    </button>
                    <button className="text-yellow-400 hover:text-yellow-300">
                        <img src="public/sendMessage.png"></img>
                    </button>
                </div>
            </div>
        </div>
    )
}

export default Chat