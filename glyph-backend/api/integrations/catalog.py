"""Static catalog of supported integrations.

Each IntegrationSpec defines the credentials a user must supply and
the capabilities the agent gains once connected.
"""

from dataclasses import dataclass, asdict


@dataclass
class CredentialField:
    key: str
    label: str
    description: str
    sensitive: bool = True
    field_type: str = "text"  # "text" | "oauth"


@dataclass
class IntegrationSpec:
    id: str
    name: str
    icon: str
    description: str
    credential_fields: list[CredentialField]
    capabilities: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


CATALOG: dict[str, IntegrationSpec] = {
    "gmail": IntegrationSpec(
        id="gmail",
        name="Gmail",
        icon="✉️",
        description="Read, send, and draft emails via your Gmail account.",
        credential_fields=[
            CredentialField(
                key="oauth",
                label="Google Account",
                description="Authorize Glyph to access your Gmail inbox.",
                sensitive=False,
                field_type="oauth",
            )
        ],
        capabilities=["List recent emails", "Read email content", "Send emails", "Create drafts"],
    ),
    "outlook": IntegrationSpec(
        id="outlook",
        name="Outlook",
        icon="📧",
        description="Send and read emails via Microsoft Outlook.",
        credential_fields=[
            CredentialField(
                key="access_token",
                label="Access Token",
                description="Generate from portal.azure.com under your app's API permissions (Mail.ReadWrite + Mail.Send scopes).",
            ),
            CredentialField(
                key="email",
                label="Email Address",
                description="Your Outlook / Microsoft email address.",
                sensitive=False,
            ),
        ],
        capabilities=["Send emails", "Read inbox", "List messages"],
    ),
    "discord": IntegrationSpec(
        id="discord",
        name="Discord",
        icon="🎮",
        description="Send messages to a Discord channel via a bot.",
        credential_fields=[
            CredentialField(
                key="bot_token",
                label="Bot Token",
                description="1. Go to discord.com/developers/applications  2. New Application → Bot tab  3. Click Reset Token and copy it  4. Under Privileged Intents enable Message Content Intent",
            ),
            CredentialField(
                key="channel_id",
                label="Channel ID",
                description="1. Open Discord  2. Settings → Advanced → enable Developer Mode  3. Right-click the target channel  4. Click Copy Channel ID",
                sensitive=False,
            ),
        ],
        capabilities=["Send messages to a channel", "Post updates and notifications"],
    ),
    "telegram": IntegrationSpec(
        id="telegram",
        name="Telegram",
        icon="✈️",
        description="Send messages via a Telegram bot.",
        credential_fields=[
            CredentialField(
                key="bot_token",
                label="Bot Token",
                description="1. Open Telegram  2. Message @BotFather  3. Send /newbot and follow the prompts  4. Copy the token it gives you",
            ),
            CredentialField(
                key="chat_id",
                label="Chat ID",
                description="1. Add your bot to the target chat  2. Message @userinfobot in that chat  3. Copy the Chat ID it shows",
                sensitive=False,
            ),
        ],
        capabilities=["Send messages", "Post notifications to a chat"],
    ),
    "teams": IntegrationSpec(
        id="teams",
        name="Microsoft Teams",
        icon="💼",
        description="Post messages to a Teams channel via an Incoming Webhook.",
        credential_fields=[
            CredentialField(
                key="webhook_url",
                label="Webhook URL",
                description="1. Open Teams  2. Right-click the target channel → Connectors  3. Find Incoming Webhook → Configure  4. Give it a name and copy the URL",
            ),
        ],
        capabilities=["Post messages to a channel", "Send notifications"],
    ),
    "slack": IntegrationSpec(
        id="slack",
        name="Slack",
        icon="💬",
        description="Post messages to a Slack channel via an Incoming Webhook.",
        credential_fields=[
            CredentialField(
                key="webhook_url",
                label="Webhook URL",
                description="1. Go to api.slack.com/apps  2. Create App → Incoming Webhooks  3. Activate Incoming Webhooks  4. Add New Webhook to Workspace, pick a channel, copy the URL",
            ),
        ],
        capabilities=["Post messages to a channel", "Send notifications"],
    ),
}
