Cloud Metadata Service Exposure Risks

Cloud providers expose a metadata service API at 169.254.169.254 accessible to code running on virtual machines, enabling retrieval of both benign configuration data and sensitive credentials including IAM role credentials and service account tokens. Attackers can perform simple reconnaissance scans to identify and potentially exploit this service for unauthorized access to cloud resources.
