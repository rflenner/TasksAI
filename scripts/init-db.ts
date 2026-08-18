import "./migrate";
import postgres from "postgres";
if(process.env.BOOTSTRAP_SITE_ADMIN==="true"){
 const email=process.env.SITE_ADMIN_EMAIL?.trim().toLowerCase(),firstName=process.env.SITE_ADMIN_FIRST_NAME?.trim(),lastName=process.env.SITE_ADMIN_LAST_NAME?.trim(),company=process.env.SITE_ADMIN_COMPANY?.trim();
 if(!email||!firstName||!lastName||!company)throw new Error("SITE_ADMIN_EMAIL, SITE_ADMIN_FIRST_NAME, SITE_ADMIN_LAST_NAME and SITE_ADMIN_COMPANY are required when bootstrap is enabled");
 const url=process.env.DATABASE_URL;if(!url)throw new Error("DATABASE_URL is required");const sql=postgres(url,{max:1,ssl:process.env.DATABASE_SSL==="disable"?false:"require"});
 await sql.begin(async tx=>{const normalized=company.toLocaleLowerCase();const[companyRow]=await tx`INSERT INTO companies (name,normalized_name) VALUES (${company},${normalized}) ON CONFLICT (normalized_name) DO UPDATE SET name=EXCLUDED.name RETURNING id`;await tx`INSERT INTO users (email,name,first_name,last_name,company_id,role,status,email_verified_at,accepted_at,can_invite) VALUES (${email},${`${firstName} ${lastName}`},${firstName},${lastName},${companyRow.id},'site_admin','active',now(),now(),true) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,company_id=EXCLUDED.company_id,role='site_admin',status='active',email_verified_at=COALESCE(users.email_verified_at,now()),can_invite=true`;});
 await sql.end();console.log(`Site Admin ensured for ${email}`);
}
