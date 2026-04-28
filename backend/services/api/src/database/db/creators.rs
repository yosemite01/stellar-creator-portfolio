use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Project {
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub image: String,
    pub link: Option<String>,
    pub tags: Vec<String>,
    pub year: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CreatorStats {
    pub projects: i32,
    pub clients: i32,
    pub experience: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Creator {
    pub id: String,
    pub name: String,
    pub title: String,
    pub discipline: String,
    pub bio: String,
    pub avatar: String,
    #[serde(rename = "coverImage")]
    pub cover_image: String,
    pub tagline: String,
    #[serde(rename = "linkedIn")]
    pub linked_in: String,
    pub twitter: String,
    pub portfolio: Option<String>,
    pub projects: Vec<Project>,
    pub skills: Vec<String>,
    pub stats: Option<CreatorStats>,
    #[serde(rename = "hourlyRate")]
    pub hourly_rate: Option<i32>,
    #[serde(rename = "responseTime")]
    pub response_time: Option<String>,
    pub availability: Option<String>,
    pub rating: Option<f32>,
    #[serde(rename = "reviewCount")]
    pub review_count: Option<i32>,
}

pub fn get_mock_creators() -> Vec<Creator> {
    vec![
        Creator {
            id: "alex-studio".to_string(),
            name: "Alex Chen".to_string(),
            title: "Product Designer".to_string(),
            discipline: "UI/UX Design".to_string(),
            bio: "Crafting intuitive digital experiences that solve real problems. Specialized in design systems and user-centered methodology.".to_string(),
            avatar: "/avatars/alex-chen.jpg".to_string(),
            cover_image: "/covers/design-studio.jpg".to_string(),
            tagline: "Design systems that scale".to_string(),
            linked_in: "https://linkedin.com/in/alexchen".to_string(),
            twitter: "https://x.com/alexchen".to_string(),
            portfolio: Some("https://alexchen.design".to_string()),
            projects: vec![],
            skills: vec!["Figma".to_string(), "Design Systems".to_string(), "Prototyping".to_string()],
            stats: Some(CreatorStats {
                projects: 45,
                clients: 20,
                experience: 8,
            }),
            hourly_rate: Some(150),
            response_time: Some("2 hours".to_string()),
            availability: Some("available".to_string()),
            rating: Some(4.9),
            review_count: Some(82),
        },
        Creator {
            id: "jordan-dev".to_string(),
            name: "Jordan Smith".to_string(),
            title: "Full Stack Developer".to_string(),
            discipline: "Software Development".to_string(),
            bio: "Experienced full-stack developer with expertise in React, Node.js, and cloud technologies.".to_string(),
            avatar: "/avatars/jordan-smith.jpg".to_string(),
            cover_image: "/covers/dev-workspace.jpg".to_string(),
            tagline: "Building scalable web applications".to_string(),
            linked_in: "https://linkedin.com/in/jordansmith".to_string(),
            twitter: "https://x.com/jordansmith".to_string(),
            portfolio: Some("https://jordansmith.dev".to_string()),
            projects: vec![],
            skills: vec!["React".to_string(), "Node.js".to_string(), "TypeScript".to_string(), "PostgreSQL".to_string()],
            stats: Some(CreatorStats {
                projects: 52,
                clients: 28,
                experience: 10,
            }),
            hourly_rate: Some(120),
            response_time: Some("1 hour".to_string()),
            availability: Some("limited".to_string()),
            rating: Some(4.8),
            review_count: Some(95),
        },
        Creator {
            id: "maya-content".to_string(),
            name: "Maya Rodriguez".to_string(),
            title: "Content Strategist".to_string(),
            discipline: "Content Creation".to_string(),
            bio: "Digital content strategist specializing in brand storytelling and audience engagement.".to_string(),
            avatar: "/avatars/maya-rodriguez.jpg".to_string(),
            cover_image: "/covers/content-creative.jpg".to_string(),
            tagline: "Stories that drive engagement".to_string(),
            linked_in: "https://linkedin.com/in/mayarodriguez".to_string(),
            twitter: "https://x.com/mayarodriguez".to_string(),
            portfolio: Some("https://mayarodriguez.com".to_string()),
            projects: vec![],
            skills: vec!["Copywriting".to_string(), "SEO".to_string(), "Social Media".to_string()],
            stats: Some(CreatorStats {
                projects: 38,
                clients: 15,
                experience: 6,
            }),
            hourly_rate: Some(85),
            response_time: Some("4 hours".to_string()),
            availability: Some("available".to_string()),
            rating: Some(4.7),
            review_count: Some(45),
        },
    ]
}

pub fn filter_creators(creators: Vec<Creator>, discipline: Option<String>, search: Option<String>) -> Vec<Creator> {
    creators
        .into_iter()
        .filter(|creator| {
            if let Some(ref d) = discipline {
                if !creator.discipline.to_lowercase().contains(&d.to_lowercase()) {
                    return false;
                }
            }
            if let Some(ref s) = search {
                if !creator.name.to_lowercase().contains(&s.to_lowercase())
                    && !creator.bio.to_lowercase().contains(&s.to_lowercase())
                    && !creator.skills.iter().any(|skill| skill.to_lowercase().contains(&s.to_lowercase()))
                {
                    return false;
                }
            }
            true
        })
        .collect()
}

pub fn get_creator_by_id(creator_id: &str) -> Option<Creator> {
    if !is_valid_creator_id(creator_id) {
        return None;
    }

    let creators = get_mock_creators();
    creators
        .into_iter()
        .find(|creator| creator.id == creator_id)
}

pub fn is_valid_creator_id(creator_id: &str) -> bool {
    !creator_id.is_empty()
        && creator_id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        && !creator_id.starts_with('-')
        && !creator_id.ends_with('-')
        && !creator_id.contains("--")
}

#[cfg(test)]
mod tests {
    use super::{get_creator_by_id, is_valid_creator_id};

    #[test]
    fn get_creator_by_id_returns_known_creator() {
        let creator = get_creator_by_id("alex-studio").expect("known creator");
        assert_eq!(creator.name, "Alex Chen");
    }

    #[test]
    fn get_creator_by_id_returns_none_for_missing_creator() {
        assert!(get_creator_by_id("missing-creator").is_none());
    }

    #[test]
    fn get_creator_by_id_rejects_malformed_ids() {
        assert!(!is_valid_creator_id("../alex-studio"));
        assert!(get_creator_by_id("../alex-studio").is_none());
    }
}
