import { useNavigate } from 'react-router-dom';

function Navigation({ isMobile, setIsMobile }) {    
    const navigate = useNavigate();
return (
        <div>
            
            <div className="relative border-b border-b-neutral-800 border-solid md:flex justify-between items-center py-4 px-8 lg:px-20 w-full">                
                <div className="flex flex-row justify-between lg:ml-8">
                    <div className="flex flex-row gap-x-4 items-center text-white md:ml-20">
                        <button onClick={() => navigate('/')}>
                            <img src="/public/logo-white.png" height={40} width={40}></img>
                        </button>
                        <button onClick={() => navigate('/')}>LangPulse</button>
                    </div>

                    <button className="md:hidden" onClick={() => setIsMobile(!isMobile)}>
                        <img src="/public/hamburger.png"></img>
                    </button>
                </div>
                <div className="hidden md:flex flex-row text-white gap-x-12 ml-20 mr-20 text-zinc-500 lg:gap-x-24 mr-30 ml-30">
                    <button>Pricing</button>
                    <button>More</button>
                </div>

                <div className="hidden md:flex flex-row text-white gap-x-10 mr-20">
                    <button onClick={() => navigate('/login') }>Log in</button>
                    <button className="md:bg-white text-black p-2 rounded-full">Get Started</button>
                </div>
            </div>

            {isMobile && (
                <div className="absolute h-screen bg-black w-full text-white flex flex-col items-center justify-between border-t border-t-neutral-800 border-solid">
                {/* Adjust the top offset (64px) to match your nav height */}
                <div className="flex flex-col justify-between mt-8 gap-y-8">
                    <button>More</button>
                    <button>Docs</button>
                </div>

                <div className="flex flex-col justify-between mb-8 gap-y-8">
                    <button className="py-4 px-8 border border-white border-solid rounded-full">Log In</button>
                    <button className="bg-white py-4 px-8 border border-white border-solid rounded-full text-black">Get Started</button>
                </div>
                </div>
            )}
        </div>

    )
}

export default Navigation