use utoipa::openapi::security::{Http, HttpAuthScheme, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::handlers;
use crate::models;
use crate::state;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Together API",
        description = "Private, non-federated Discord alternative for small gaming communities",
        version = "0.1.0",
        license(name = "PolyForm Noncommercial 1.0.0")
    ),
    paths(
        // Auth
        handlers::auth::register,
        handlers::auth::login,
        handlers::auth::refresh_token,
        handlers::auth::forgot_password,
        handlers::auth::reset_password,
        handlers::auth::get_registration_mode,
        // Health
        handlers::health::health_check,
        handlers::health::readiness_check,
        handlers::health::liveness_check,
        // Users
        handlers::users::get_current_user,
        handlers::users::update_current_user,
        handlers::users::get_user_profile,
        // Servers
        handlers::servers::create_server,
        handlers::servers::list_servers,
        handlers::servers::get_server,
        handlers::servers::update_server,
        handlers::servers::delete_server,
        handlers::servers::join_server,
        handlers::servers::leave_server,
        handlers::servers::browse_servers,
        handlers::servers::list_members,
        // Channels
        handlers::channels::create_channel,
        handlers::channels::list_channels,
        handlers::channels::get_channel,
        handlers::channels::update_channel,
        handlers::channels::delete_channel,
        // Messages
        handlers::messages::create_message,
        handlers::messages::list_messages,
        handlers::messages::update_message,
        handlers::messages::delete_message,
        handlers::messages::get_message,
        handlers::messages::create_thread_reply,
        handlers::messages::list_thread_replies,
        // DMs
        handlers::dm::open_dm_channel,
        handlers::dm::list_dm_channels,
        handlers::dm::send_dm_message,
        handlers::dm::list_dm_messages,
        // Search
        handlers::search::search_messages,
        // Reactions
        handlers::reactions::add_reaction,
        handlers::reactions::remove_reaction,
        handlers::reactions::list_reactions,
        // Pins
        handlers::pins::pin_message,
        handlers::pins::unpin_message,
        handlers::pins::list_pinned_messages,
        // Polls
        handlers::polls::create_poll,
        handlers::polls::get_poll,
        handlers::polls::cast_vote,
        // Events
        handlers::events::create_event,
        handlers::events::list_events,
        // Voice
        handlers::voice::join_voice_channel,
        handlers::voice::leave_voice_channel,
        handlers::voice::update_voice_state,
        handlers::voice::list_voice_participants,
        // Go Live
        handlers::go_live::start_go_live,
        handlers::go_live::stop_go_live,
        handlers::go_live::get_go_live,
        // ICE
        handlers::ice::get_ice_servers,
        // Bots
        handlers::bots::create_bot,
        handlers::bots::list_bots,
        handlers::bots::get_bot,
        handlers::bots::revoke_bot,
        handlers::bots::regenerate_bot_token,
        handlers::bots::update_bot,
        handlers::bots::bot_logs,
        handlers::bots::bot_connect,
        // Webhooks
        handlers::webhooks::create_webhook,
        handlers::webhooks::list_webhooks,
        handlers::webhooks::get_webhook,
        handlers::webhooks::update_webhook,
        handlers::webhooks::delete_webhook,
        handlers::webhooks::test_webhook,
        // Invites
        handlers::invites::create_invite,
        handlers::invites::list_invites,
        handlers::invites::delete_invite,
        handlers::invites::preview_invite,
        handlers::invites::accept_invite,
        // Roles
        handlers::roles::create_role,
        handlers::roles::list_roles,
        handlers::roles::update_role,
        handlers::roles::delete_role,
        handlers::roles::assign_role,
        handlers::roles::remove_role,
        // Channel overrides
        handlers::channel_overrides::list_overrides,
        handlers::channel_overrides::set_override,
        handlers::channel_overrides::delete_override,
        // Moderation
        handlers::moderation::kick_member,
        handlers::moderation::ban_member,
        handlers::moderation::timeout_member,
        handlers::moderation::remove_timeout,
        // Admin
        handlers::admin::get_stats,
        handlers::admin::get_settings,
        handlers::admin::update_settings,
        handlers::admin::list_users,
        handlers::admin::update_user,
        handlers::admin::delete_user,
        handlers::admin::list_servers,
        handlers::admin::delete_server,
        // Automod
        handlers::automod::get_automod_config,
        handlers::automod::update_automod_config,
        handlers::automod::list_word_filters,
        handlers::automod::add_word_filter,
        handlers::automod::remove_word_filter,
        handlers::automod::list_automod_logs,
        handlers::automod::list_bans,
        handlers::automod::remove_ban,
        // Audit
        handlers::audit::list_audit_logs,
        // Attachments
        handlers::attachments::upload_attachments,
        handlers::attachments::list_attachments,
        handlers::attachments::serve_file,
        // Custom emojis
        handlers::custom_emojis::list_custom_emojis,
        handlers::custom_emojis::upload_custom_emoji,
        handlers::custom_emojis::delete_custom_emoji,
        handlers::custom_emojis::serve_custom_emoji_image,
        // Templates
        handlers::templates::list_templates,
        // Giphy
        handlers::giphy::search_giphy,
        // Link preview
        handlers::link_preview::get_link_preview,
        // Read states
        handlers::read_states::ack_channel,
        handlers::read_states::ack_dm_channel,
        // Export
        handlers::export::export_server,
    ),
    components(schemas(
        // User models
        models::UserDto,
        models::PublicProfileDto,
        models::CreateUserDto,
        models::UpdateUserDto,
        // Server models
        models::Server,
        models::ServerDto,
        models::CreateServerDto,
        models::UpdateServerDto,
        models::ServerMember,
        models::MemberDto,
        // Channel models
        models::ChannelType,
        models::Channel,
        models::CreateChannelDto,
        models::UpdateChannelDto,
        // Message models
        models::Message,
        models::MessageDto,
        models::CreateMessageDto,
        models::UpdateMessageDto,
        // Voice models
        models::VoiceStateDto,
        models::UpdateVoiceStateRequest,
        // Attachment
        models::Attachment,
        // Custom emoji
        models::CustomEmojiDto,
        // DM models
        models::DirectMessageChannel,
        models::DirectMessageChannelDto,
        models::DirectMessage,
        models::CreateDirectMessageDto,
        // Reactions
        models::ReactionCount,
        // Read states
        models::UnreadCount,
        // Polls
        models::PollOption,
        models::PollDto,
        models::PollOptionDto,
        models::CreatePollPayload,
        models::CastVotePayload,
        // Events
        models::ServerEventDto,
        models::CreateEventPayload,
        // Giphy
        models::GifResult,
        // Audit
        models::AuditLog,
        models::AuditAction,
        models::ListAuditLogsQuery,
        // Moderation
        models::KickMemberRequest,
        models::BanMemberRequest,
        models::TimeoutMemberRequest,
        // Search
        models::SearchQuery,
        models::SearchResult,
        models::SearchResponse,
        // Bots
        models::BotDto,
        models::CreateBotDto,
        models::UpdateBotDto,
        models::BotLogEntry,
        models::BotCreatedResponse,
        // Automod
        models::AutomodConfig,
        models::UpdateAutomodConfigRequest,
        models::AutomodWordFilter,
        models::AddWordFilterRequest,
        models::AutomodLog,
        models::ServerBan,
        models::AutomodTimeout,
        // Roles
        models::Role,
        models::MemberRoleInfo,
        models::CreateRoleRequest,
        models::UpdateRoleRequest,
        // Channel overrides
        models::ChannelPermissionOverride,
        models::SetChannelOverrideRequest,
        // Webhooks
        models::WebhookDto,
        models::WebhookCreatedResponse,
        models::CreateWebhookDto,
        models::UpdateWebhookDto,
        // Invites
        models::ServerInvite,
        models::InvitePreviewDto,
        models::CreateInviteRequest,
        // Templates
        models::TemplateChannelDto,
        models::ServerTemplateDto,
        // Settings
        models::InstanceSettings,
        models::UpdateSettingsRequest,
        // Admin
        models::AdminStatsResponse,
        models::AdminUserDto,
        models::AdminUsersResponse,
        models::AdminServerDto,
        models::AdminServersResponse,
        models::UpdateAdminUserRequest,
        models::AdminListQuery,
        // Link preview
        models::LinkPreviewDto,
        // Handler-local types
        handlers::auth::RegisterRequest,
        handlers::auth::LoginRequest,
        handlers::auth::RefreshRequest,
        handlers::auth::AuthResponse,
        handlers::auth::ForgotPasswordRequest,
        handlers::auth::ResetPasswordRequest,
        handlers::health::HealthResponse,
        handlers::health::DatabaseHealth,
        handlers::health::ConnectionsHealth,
        handlers::health::ReadinessResponse,
        handlers::health::CheckResult,
        handlers::health::LivenessResponse,
        handlers::ice::IceServer,
        handlers::ice::IceServersResponse,
        handlers::bots::ListBotsResponse,
        handlers::bots::BotLogsResponse,
        handlers::go_live::StartGoLiveRequest,
        handlers::servers::CreateServerRequest,
        handlers::servers::UpdateServerRequest,
        handlers::servers::MemberWithRolesDto,
        state::GoLiveSession,
    )),
    modifiers(&SecurityAddon),
    tags(
        (name = "Auth", description = "Authentication and registration"),
        (name = "Health", description = "Health check endpoints"),
        (name = "Users", description = "User profile management"),
        (name = "Servers", description = "Server (guild) management"),
        (name = "Channels", description = "Channel management"),
        (name = "Messages", description = "Message CRUD and threads"),
        (name = "DirectMessages", description = "Direct message channels"),
        (name = "Search", description = "Full-text message search"),
        (name = "Reactions", description = "Message reactions"),
        (name = "Pins", description = "Pinned messages"),
        (name = "Polls", description = "Polls"),
        (name = "Events", description = "Server events"),
        (name = "Voice", description = "Voice channel state"),
        (name = "GoLive", description = "Screen sharing / Go Live"),
        (name = "ICE", description = "WebRTC ICE server credentials"),
        (name = "Bots", description = "Bot account management"),
        (name = "Webhooks", description = "Webhook management"),
        (name = "Invites", description = "Server invite links"),
        (name = "Roles", description = "Role management and assignment"),
        (name = "ChannelOverrides", description = "Per-channel permission overrides"),
        (name = "Moderation", description = "Kick, ban, timeout"),
        (name = "Admin", description = "Instance administration"),
        (name = "Automod", description = "Auto-moderation configuration"),
        (name = "AuditLogs", description = "Server audit trail"),
        (name = "Attachments", description = "File attachments"),
        (name = "CustomEmojis", description = "Custom emoji management"),
        (name = "Templates", description = "Server templates"),
        (name = "Giphy", description = "GIF search via Giphy"),
        (name = "LinkPreview", description = "Open Graph link previews"),
        (name = "ReadStates", description = "Read state acknowledgement"),
        (name = "Export", description = "Server data export"),
    )
)]
pub struct ApiDoc;

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
            );
        }
    }
}
