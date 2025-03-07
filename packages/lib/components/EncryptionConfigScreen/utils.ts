import shim from '../../shim';
import { _ } from '../../locale';
import BaseItem, { EncryptedItemsStats } from '../../models/BaseItem';
import useAsyncEffect, { AsyncEffectEvent } from '../../hooks/useAsyncEffect';
import { MasterKeyEntity } from '../../services/e2ee/types';
import time from '../../time';
import { findMasterKeyPassword } from '../../services/e2ee/utils';
import EncryptionService from '../../services/e2ee/EncryptionService';
import { masterKeyEnabled, setMasterKeyEnabled } from '../../services/synchronizer/syncInfoUtils';
import MasterKey from '../../models/MasterKey';
import { reg } from '../../registry';
import Setting from '../../models/Setting';
const { useCallback, useEffect, useState } = shim.react();

type PasswordChecks = Record<string, boolean>;

export const useStats = () => {
	const [stats, setStats] = useState<EncryptedItemsStats>({ encrypted: null, total: null });
	const [statsUpdateTime, setStatsUpdateTime] = useState<number>(0);

	useAsyncEffect(async (event: AsyncEffectEvent) => {
		const r = await BaseItem.encryptedItemsStats();
		if (event.cancelled) return;
		setStats(r);
	}, [statsUpdateTime]);

	useEffect(() => {
		const iid = shim.setInterval(() => {
			setStatsUpdateTime(Date.now());
		}, 3000);

		return () => {
			clearInterval(iid);
		};
	}, []);

	return stats;
};

export const decryptedStatText = (stats: EncryptedItemsStats) => {
	const doneCount = stats.encrypted !== null ? stats.total - stats.encrypted : '-';
	const totalCount = stats.total !== null ? stats.total : '-';
	const result = _('Decrypted items: %s / %s', doneCount, totalCount);
	return result;
};

export const enableEncryptionConfirmationMessages = (masterKey: MasterKeyEntity) => {
	const msg = [_('Enabling encryption means *all* your notes and attachments are going to be re-synchronised and sent encrypted to the sync target. Do not lose the password as, for security purposes, this will be the *only* way to decrypt the data! To enable encryption, please enter your password below.')];
	if (masterKey) msg.push(_('Encryption will be enabled using the master key created on %s', time.unixMsToLocalDateTime(masterKey.created_time)));
	return msg;
};

const masterPasswordIsValid = async (masterKeys: MasterKeyEntity[], activeMasterKeyId: string, masterPassword: string = null) => {
	const activeMasterKey = masterKeys.find((mk: MasterKeyEntity) => mk.id === activeMasterKeyId);
	masterPassword = masterPassword === null ? masterPassword : masterPassword;
	if (activeMasterKey && masterPassword) {
		return EncryptionService.instance().checkMasterKeyPassword(activeMasterKey, masterPassword);
	}

	return false;
};

export const reencryptData = async () => {
	const ok = confirm(_('Please confirm that you would like to re-encrypt your complete database.'));
	if (!ok) return;

	await BaseItem.forceSyncAll();
	void reg.waitForSyncFinishedThenSync();
	Setting.setValue('encryption.shouldReencrypt', Setting.SHOULD_REENCRYPT_NO);
	alert(_('Your data is going to be re-encrypted and synced again.'));
};

export const dontReencryptData = () => {
	Setting.setValue('encryption.shouldReencrypt', Setting.SHOULD_REENCRYPT_NO);
};

export const useToggleShowDisabledMasterKeys = () => {
	const [showDisabledMasterKeys, setShowDisabledMasterKeys] = useState<boolean>(false);

	const toggleShowDisabledMasterKeys = () => {
		setShowDisabledMasterKeys((current) => !current);
	};

	return { showDisabledMasterKeys, toggleShowDisabledMasterKeys };
};

export const onToggleEnabledClick = (mk: MasterKeyEntity) => {
	setMasterKeyEnabled(mk.id, !masterKeyEnabled(mk));
};

export const onSavePasswordClick = (mk: MasterKeyEntity, passwords: Record<string, string>) => {
	const password = passwords[mk.id];
	if (!password) {
		Setting.deleteObjectValue('encryption.passwordCache', mk.id);
	} else {
		Setting.setObjectValue('encryption.passwordCache', mk.id, password);
	}
};

export const onMasterPasswordSave = (masterPasswordInput: string) => {
	Setting.setValue('encryption.masterPassword', masterPasswordInput);
};

export const useInputMasterPassword = (masterKeys: MasterKeyEntity[], activeMasterKeyId: string) => {
	const [inputMasterPassword, setInputMasterPassword] = useState<string>('');

	const onMasterPasswordSave = useCallback(async () => {
		Setting.setValue('encryption.masterPassword', inputMasterPassword);

		if (!(await masterPasswordIsValid(masterKeys, activeMasterKeyId, inputMasterPassword))) {
			alert('Password is invalid. Please try again.');
		}
	}, [inputMasterPassword]);

	const onMasterPasswordChange = useCallback((password: string) => {
		setInputMasterPassword(password);
	}, []);

	return { inputMasterPassword, onMasterPasswordSave, onMasterPasswordChange };
};

export const useInputPasswords = (propsPasswords: Record<string, string>) => {
	const [inputPasswords, setInputPasswords] = useState<Record<string, string>>(propsPasswords);

	useEffect(() => {
		setInputPasswords(propsPasswords);
	}, [propsPasswords]);

	const onInputPasswordChange = useCallback((mk: MasterKeyEntity, password: string) => {
		setInputPasswords(current => {
			return {
				...current,
				[mk.id]: password,
			};
		});
	}, []);

	return { inputPasswords, onInputPasswordChange };
};

export const usePasswordChecker = (masterKeys: MasterKeyEntity[], activeMasterKeyId: string, masterPassword: string, passwords: Record<string, string>) => {
	const [passwordChecks, setPasswordChecks] = useState<PasswordChecks>({});
	const [masterPasswordKeys, setMasterPasswordKeys] = useState<PasswordChecks>({});

	useAsyncEffect(async (event: AsyncEffectEvent) => {
		const newPasswordChecks: PasswordChecks = {};
		const newMasterPasswordKeys: PasswordChecks = {};

		for (let i = 0; i < masterKeys.length; i++) {
			const mk = masterKeys[i];
			const password = await findMasterKeyPassword(EncryptionService.instance(), mk, passwords);
			const ok = password ? await EncryptionService.instance().checkMasterKeyPassword(mk, password) : false;
			newPasswordChecks[mk.id] = ok;
			newMasterPasswordKeys[mk.id] = password === masterPassword;
		}

		newPasswordChecks['master'] = await masterPasswordIsValid(masterKeys, activeMasterKeyId, masterPassword);

		if (event.cancelled) return;

		setPasswordChecks(newPasswordChecks);
		setMasterPasswordKeys(newMasterPasswordKeys);
	}, [masterKeys, masterPassword]);

	return { passwordChecks, masterPasswordKeys };
};

export const upgradeMasterKey = async (masterKey: MasterKeyEntity, passwordChecks: PasswordChecks, passwords: Record<string, string>): Promise<string> => {
	const passwordCheck = passwordChecks[masterKey.id];
	if (!passwordCheck) {
		return _('Please enter your password in the master key list below before upgrading the key.');
	}

	try {
		const password = passwords[masterKey.id];
		const newMasterKey = await EncryptionService.instance().upgradeMasterKey(masterKey, password);
		await MasterKey.save(newMasterKey);
		void reg.waitForSyncFinishedThenSync();
		return _('The master key has been upgraded successfully!');
	} catch (error) {
		return _('Could not upgrade master key: %s', error.message);
	}
};
