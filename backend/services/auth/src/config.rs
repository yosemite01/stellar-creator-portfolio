use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct OAuthProviderConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OAuthProvider {
    Google,
    GitHub,
    Twitter,
}

impl OAuthProvider {
    pub fn from_str(provider: &str) -> Option<Self> {
        match provider.to_lowercase().as_str() {
            "google" => Some(OAuthProvider::Google),
            "github" => Some(OAuthProvider::GitHub),
            "twitter" => Some(OAuthProvider::Twitter),
            _ => None,
        }
    }
}

impl std::fmt::Display for OAuthProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            OAuthProvider::Google => "google",
            OAuthProvider::GitHub => "github",
            OAuthProvider::Twitter => "twitter",
        };
        write!(f, "{}", s)
    }
}

#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub jwt_secret: String,
    pub access_ttl_secs: u64,
    pub refresh_ttl_secs: u64,
    /// When set, `POST /auth/token` requires matching `X-Mint-Secret` header.
    pub mint_secret: Option<String>,
    /// When true and `mint_secret` is unset, allows mint without a secret (development only).
    pub dev_mint_allow: bool,
    pub google_oauth: Option<OAuthProviderConfig>,
    pub github_oauth: Option<OAuthProviderConfig>,
    pub twitter_oauth: Option<OAuthProviderConfig>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let jwt_secret = std::env::var("JWT_SECRET")
            .context("JWT_SECRET is required for signing access tokens")?;
        if jwt_secret.len() < 32 {
            anyhow::bail!("JWT_SECRET must be at least 32 characters");
        }

        let mint_secret = std::env::var("AUTH_MINT_SECRET")
            .ok()
            .filter(|s| !s.is_empty());
        let dev_mint_allow = std::env::var("AUTH_DEV_MINT")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

        let access_ttl_secs = std::env::var("AUTH_ACCESS_TOKEN_TTL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(900);

        let refresh_ttl_secs = std::env::var("AUTH_REFRESH_TOKEN_TTL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(604_800);

        fn provider_config(prefix: &str) -> Option<OAuthProviderConfig> {
            let client_id = std::env::var(format!("{}_CLIENT_ID", prefix)).ok()?.trim().to_owned();
            let client_secret = std::env::var(format!("{}_CLIENT_SECRET", prefix)).ok()?.trim().to_owned();
            let redirect_uri = std::env::var(format!("{}_REDIRECT_URI", prefix)).ok()?.trim().to_owned();
            if client_id.is_empty() || client_secret.is_empty() || redirect_uri.is_empty() {
                return None;
            }
            Some(OAuthProviderConfig {
                client_id,
                client_secret,
                redirect_uri,
            })
        }

        let google_oauth = provider_config("GOOGLE_OAUTH");
        let github_oauth = provider_config("GITHUB_OAUTH");
        let twitter_oauth = provider_config("TWITTER_OAUTH");

        Ok(Config {
            host: std::env::var("AUTH_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("AUTH_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(8080),
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            jwt_secret,
            access_ttl_secs,
            refresh_ttl_secs,
            mint_secret,
            dev_mint_allow,
            google_oauth,
            github_oauth,
            twitter_oauth,
        })
    }

    pub fn mint_allowed(&self, header_secret: Option<&str>) -> bool {
        match &self.mint_secret {
            Some(expected) => header_secret.is_some_and(|h| h == expected.as_str()),
            None => self.dev_mint_allow,
        }
    }

    pub fn oauth_provider_config(&self, provider: OAuthProvider) -> Option<&OAuthProviderConfig> {
        match provider {
            OAuthProvider::Google => self.google_oauth.as_ref(),
            OAuthProvider::GitHub => self.github_oauth.as_ref(),
            OAuthProvider::Twitter => self.twitter_oauth.as_ref(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_auth_provider_from_str() {
        assert_eq!(OAuthProvider::from_str("google"), Some(OAuthProvider::Google));
        assert_eq!(OAuthProvider::from_str("github"), Some(OAuthProvider::GitHub));
        assert_eq!(OAuthProvider::from_str("twitter"), Some(OAuthProvider::Twitter));
        assert_eq!(OAuthProvider::from_str("bad"), None);
    }

    #[test]
    fn config_implements_oauth_provider_config() {
        std::env::set_var("JWT_SECRET", "01234567890123456789012345678901");
        std::env::set_var("DATABASE_URL", "postgres://localhost/test");
        std::env::set_var("GOOGLE_OAUTH_CLIENT_ID", "gcid");
        std::env::set_var("GOOGLE_OAUTH_CLIENT_SECRET", "gsecret");
        std::env::set_var("GOOGLE_OAUTH_REDIRECT_URI", "https://localhost/callback");

        let cfg = Config::from_env().expect("config load");

        let google_config = cfg.oauth_provider_config(OAuthProvider::Google).expect("google configured");
        assert_eq!(google_config.client_id, "gcid");
        assert_eq!(google_config.client_secret, "gsecret");
        assert_eq!(google_config.redirect_uri, "https://localhost/callback");
    }
}

