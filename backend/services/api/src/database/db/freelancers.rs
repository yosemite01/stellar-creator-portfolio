use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FreelancerRegistration {
    pub name: String,
    pub discipline: String,
    pub bio: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Freelancer {
    pub address: String,
    pub name: String,
    pub discipline: String,
    pub rating: f32,
    pub completed_projects: i32,
    pub verified: bool,
}

pub fn get_mock_freelancers() -> Vec<Freelancer> {
    vec![
        Freelancer {
            address: "GABC123DEF456GHI789".to_string(),
            name: "John Doe".to_string(),
            discipline: "UI/UX Design".to_string(),
            rating: 4.8,
            completed_projects: 25,
            verified: true,
        },
        Freelancer {
            address: "GXYZ789ABC123DEF456".to_string(),
            name: "Jane Smith".to_string(),
            discipline: "Full Stack Development".to_string(),
            rating: 4.9,
            completed_projects: 42,
            verified: true,
        },
        Freelancer {
            address: "GDEF456GHI789ABC123".to_string(),
            name: "Mike Johnson".to_string(),
            discipline: "Content Writing".to_string(),
            rating: 4.6,
            completed_projects: 18,
            verified: false,
        },
    ]
}

pub fn get_freelancer_by_address(address: &str) -> Option<Freelancer> {
    let freelancers = get_mock_freelancers();
    freelancers
        .into_iter()
        .find(|freelancer| freelancer.address == address)
}

pub fn filter_freelancers_by_discipline(freelancers: Vec<Freelancer>, discipline: &str) -> Vec<Freelancer> {
    if discipline.is_empty() {
        return freelancers;
    }
    
    freelancers
        .into_iter()
        .filter(|freelancer| freelancer.discipline.to_lowercase().contains(&discipline.to_lowercase()))
        .collect()
}

pub fn register_freelancer(registration: FreelancerRegistration, address: String) -> Freelancer {
    Freelancer {
        address,
        name: registration.name,
        discipline: registration.discipline,
        rating: 0.0, // New freelancers start with no rating
        completed_projects: 0,
        verified: false, // Verification process would be separate
    }
}
