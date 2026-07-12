import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { AppModule } from './app.module';
import { CountersService } from './common/counters/counters.service';
import { Office, OfficeDocument } from './modules/office/schemas/office.schema';
import { Role, RoleDocument } from './modules/roles/schemas/role.schema';
import {
  Staff,
  StaffDocument,
  StaffStatus,
} from './modules/staff/schemas/staff.schema';

const BCRYPT_ROUNDS = 10;

// Login you can use after seeding
const ADMIN_EMAIL = 'admin@codex.com';
const ADMIN_PASSWORD = 'Admin@123456'; // 12 chars, upper, digit, special — passes policy

/**
 * Idempotent seed: roles (auto-seeded on boot), one office, one admin staff.
 * Run:  npm run seed
 */
async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const officeModel = app.get<Model<OfficeDocument>>(
    getModelToken(Office.name),
  );
  const staffModel = app.get<Model<StaffDocument>>(getModelToken(Staff.name));
  const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
  const counters = app.get(CountersService);

  try {
    // 1) Office — upsert by email so re-running doesn't duplicate.
    const office = await officeModel
      .findOneAndUpdate(
        { office_email: 'head@codex.com', deleted_at: null },
        {
          $setOnInsert: {
            office_name: 'Codex HQ',
            office_email: 'head@codex.com',
            office_mobile_no: '03001112222',
            // membership_level: 'gold',
            // membership_type: 'yearly',
            licence_no: 'LIC-0001',
            approved: true,
            office_status: 'active',
            office_address: 'Lahore, Pakistan',
            biography: 'Head office (seeded)',
            deleted_at: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    console.log(`Office ready: ${office.office_name} (${office._id.toString()})`);

    // 2) Admin role for that office — roles are office-scoped now.
    let adminRole = await roleModel
      .findOne({ office_id: office._id, role: 'Admin' })
      .exec();
    if (!adminRole) {
      const _id = await counters.next('role_id');
      adminRole = await roleModel.create({ _id, role: 'Admin', office_id: office._id });
    }
    console.log(`Admin role ready (role_id=${adminRole._id})`);

    // 3) Admin staff — create only if missing.
    const existing = await staffModel
      .findOne({ email: ADMIN_EMAIL, deleted_at: null })
      .exec();

    if (existing) {
      console.log(`Staff already exists: ${ADMIN_EMAIL}`);
    } else {
      await staffModel.create({
        first_name: 'Admin',
        last_name: 'User',
        email: ADMIN_EMAIL,
        password: await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS),
        mobile_no: '03001234567',
        cnic_no: '35202-1234567-1',
        office_ids: [office._id],
        role_id: adminRole._id,
        address: 'Lahore, Pakistan',
        biography: 'Seeded admin account',
        staff_status: StaffStatus.ACTIVE,
      });
      console.log(`Created staff: ${ADMIN_EMAIL}`);
    }

    console.log('\n================ SEED COMPLETE ================');
    console.log(`  Login email   : ${ADMIN_EMAIL}`);
    console.log(`  Login password: ${ADMIN_PASSWORD}`);
    console.log('==============================================\n');
  } finally {
    await app.close();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
