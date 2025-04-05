import Chat from "./components/Chat"
function AppLayout () {
    return (
        <div className="bg-neutral-800">
            <div className="flex flex-row">
                {/* first */}
                <div className="absolute flex flex-row items-center gap-x-4 text-white mt-8 ml-8">
                        <button onClick={() => navigate('/app')}>
                            <img src="/public/logo-white.png" height={40} width={40}></img>
                        </button>
                        <button onClick={() => navigate('/app')}><b>LANGPULSE</b></button>
                        <button>
                            <img src="public/sidebarCollapse.png"></img>
                        </button>
                </div>

                <div className="flex flex-col h-screen w-60">
                    <div className="absolute flex flex-row items-center mt-40 ml-12 gap-x-2">
                        <button>
                            <img src="folder.png"></img>
                        </button>
                        <p className="text-neutral-400">Projects</p>
                        <button>
                            <img src="plus.png"></img>
                        </button>
                    </div>

                    <div className="absolute flex flex-row items-center mt-50 ml-12 gap-x-2">
                        <button>
                            <img src="conversations.png"></img>
                        </button>
                        <p className="text-neutral-400">Conversations</p>
                        <button>
                            <img src="plus.png"></img>
                        </button>
                    </div>                    

                    <div className="mt-auto border-t border-b border-neutral-700 py-3 mb-20">
                        <div className="ml-8 flex flex-row items-center gap-x-2 bg-neutral-800 rounded-full text-white">                            
                            <div className="w-10 h-10 bg-yellow-400 rounded-full flex items-center justify-center">
                                <p className="text-white font-bold">H</p>
                            </div>
                            <p>Marwan</p>
                            <button><img src="public/settings.png"></img></button>
                        </div>
                    </div>
                </div>
                {/* margin */}
                <div className="relative bg-neutral-700">
                </div>
                
                <Chat />
            </div>
        </div>
    )
}

export default AppLayout