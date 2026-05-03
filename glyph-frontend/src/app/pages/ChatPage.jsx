import { useParams } from "react-router-dom"
import Chat from "../components/Chat"

function ChatPage() {
    const { chatId } = useParams()
    return <Chat chatId={chatId} />
}

export default ChatPage
