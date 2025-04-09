import { useState } from "react"

function Message ({text}) {
    const [msgLen, setMsgLen] = useState()
    const [more, setIsMore] = useState(true)    
    function determineBtnRender () {
        
        return Boolean
    }
    return (
        <div>
            {more ? (
                <div className="bg-neutral-800 border border-yellow-300 border-solid mt-4 rounded-lg max-h-160 max-w-90 flex flex-col justify-between">
                    <p className="m-4 line-clamp-25">{text}</p>
                    <div className="flex justify-end">
                        <button
                        className="m-4"
                        onClick={() => setIsMore(!more)}
                        >More...</button>
                    </div>
                </div>

            ) : (
                <div className="bg-neutral-800 border border-yellow-300 border-solid mt-4 rounded-lg max-w-90 flex flex-col">
                    <div className="m-4">
                        <p>{text}</p>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Message